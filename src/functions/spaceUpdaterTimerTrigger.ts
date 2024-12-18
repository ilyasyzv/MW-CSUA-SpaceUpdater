import { app, InvocationContext, Timer } from "@azure/functions";
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import _ from "lodash";
import { GLOBAL_SETTINGS } from "../config/app.constants";
import { errorHandler } from "../utils/error";
import { ContentfulManager } from "../managers/contentful.manager";
import { SpaceListManager, Space } from "../managers/spaceList.manager";
import { RateLimiter } from "../utils/rateLimiter";

export async function spaceUpdaterTimerTrigger(_myTimer: Timer, _context: InvocationContext): Promise<void> {
    try {
        const secretClient = new SecretClient(
            `https://${GLOBAL_SETTINGS.AZURE_VAULT_NAME}.vault.azure.net`,
            new DefaultAzureCredential(),
        );

        const [contentfulAccessToken, bigQueryToken, inventoryAuthKey] = await Promise.all([
            secretClient.getSecret(GLOBAL_SETTINGS.CONTENTFUL_ACCESS_TOKEN_NAME),
            secretClient.getSecret(GLOBAL_SETTINGS.BIG_QUERY_TOKEN_NAME),
            secretClient.getSecret(GLOBAL_SETTINGS.MWI_API_AUTH_KEY_NAME),
        ]);

        const contentfulAccessTokenValue = contentfulAccessToken.value || "";
        const bigQueryTokenValue = JSON.parse(bigQueryToken.value || "");
        bigQueryTokenValue.private_key = bigQueryTokenValue.private_key.replace(/\\n/g, "\n");
        const inventoryAuthKeyValue = inventoryAuthKey.value || "";

        const contentfulManager = new ContentfulManager(contentfulAccessTokenValue);
        const spaceListManager = new SpaceListManager(
            bigQueryTokenValue,
            GLOBAL_SETTINGS.BIG_QUERY_DATASET_ID,
            GLOBAL_SETTINGS.BIG_QUERY_TABLE_ID,
            GLOBAL_SETTINGS.MWI_API_URL,
            inventoryAuthKeyValue,
        );

        const allSpacesPromise = contentfulManager.getAllSpaces();
        const allInstalledSpacesPromise = contentfulManager.getAllInstalledSpacesPromise();
        const [allSpaces, allInstalledSpaces] = await Promise.all([allSpacesPromise, allInstalledSpacesPromise]);

        // check where App is not installed and install it
        const rateLimiter = new RateLimiter(5, 10000);
        const installations: Array<Promise<void>> = allSpaces.flatMap(({ spaceId, environments }) =>
            environments.map((environment) => {
                if (!allInstalledSpaces[spaceId]?.[environment]) {
                    return rateLimiter.addToQueue(async () => {
                        console.log(`Installing app for spaceId: ${spaceId}, environment: ${environment}`);
                        const result = await contentfulManager.installApp({
                            spaceId: spaceId,
                            environmentId: environment,
                            appDefinitionId: GLOBAL_SETTINGS.CF_APP_DEFINITION_ID,
                        });
                        console.log(
                            result
                                ? `App installed successfully for spaceId: ${spaceId}, environment: ${environment}`
                                : `App installation error for spaceId: ${spaceId}, environment: ${environment}`,
                        );
                    });
                }

                return Promise.resolve();
            }),
        );

        await Promise.all(installations);

        // TODO
        // Need to check which Spaces is exist in `bigQuery` but didn't exist in Contentful anymore
        // And check that Spaces in `bigQuery`
        const spacesToUpdate: Space[] = allSpaces
            .map(({ spaceName, environments, createdAt }) =>
                environments.map((environment) => ({
                    name: spaceName,
                    environment,
                    createdAt: new Date(createdAt).toISOString().slice(0, -1),
                    decommissioned: 0,
                    presentInInventory: 0,
                })),
            )
            .flat();

        await spaceListManager.updateSpaceList(spacesToUpdate);

        // Decommission spaces that no longer exist in Contentful
        // Assuming fetchedSpaces represents the spaces fetched from the BigQuery table
        const fetchedSpaces: Space[] = await spaceListManager.fetchSpacesFromBigQuery();
        fetchedSpaces.forEach(({ name, environment, decommissioned }) => {
            const existsInContentful = allSpaces.some(
                (contentfulSpace) =>
                    contentfulSpace.spaceName === name && contentfulSpace.environments.includes(environment),
            );
            if (!existsInContentful) {
                if (decommissioned !== 1) {
                    spaceListManager.switchDecommissionedMark(name, environment, 1);
                }
            } else {
                if (decommissioned !== 0) {
                    spaceListManager.switchDecommissionedMark(name, environment, 0);
                }
            }
        });

        await spaceListManager.markSpacesPresentInInventory();
    } catch (error) {
        errorHandler(error as Error);
    }
}

app.timer("spaceUpdaterTimerTrigger", {
    schedule: GLOBAL_SETTINGS.SCHEDULE,
    handler: spaceUpdaterTimerTrigger,
    runOnStartup: GLOBAL_SETTINGS.IS_RUN_ON_STARTUP,
});
