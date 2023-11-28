import { app, InvocationContext, Timer } from "@azure/functions";
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import _ from "lodash";
import { GLOBAL_SETTINGS } from "../config/app.constants";
import { errorHandler } from "../utils/error";
import { ContentfulManager } from "../managers/contentful.manager";
import { SpaceListManager, Space } from "../managers/spaceList.manager";

export async function spaceUpdaterTimerTrigger(_myTimer: Timer, _context: InvocationContext): Promise<void> {
    try {
        const secretClient = new SecretClient(
            `https://${GLOBAL_SETTINGS.AZURE_VAULT_NAME}.vault.azure.net`,
            new DefaultAzureCredential(),
        );

        const [contentfulAccessToken, bigQueryToken] = await Promise.all([
            secretClient.getSecret(GLOBAL_SETTINGS.CONTENTFUL_ACCESS_TOKEN_NAME),
            secretClient.getSecret(GLOBAL_SETTINGS.BIG_QUERY_TOKEN_NAME),
        ]);

        const contentfulAccessTokenValue = contentfulAccessToken.value || "";
        const bigQueryTokenValue = JSON.parse(bigQueryToken.value || "");
        bigQueryTokenValue.private_key = bigQueryTokenValue.private_key.replace(/\\n/g, "\n");

        const contentfulManager = new ContentfulManager(contentfulAccessTokenValue);
        const spaceListManager = new SpaceListManager(bigQueryTokenValue, "dynadash_dev", "r_csu_spaces_list");

        const allSpacesPromise = contentfulManager.getAllSpaces();
        const allInstalledSpacesPromise = contentfulManager.getAllInstalledSpacesPromise();
        const [allSpaces, allInstalledSpaces] = await Promise.all([allSpacesPromise, allInstalledSpacesPromise]);

        // check where App is not installed and install it
        const installations: Array<Promise<boolean>> = [];
        allSpaces.forEach(({ spaceId, environments }) => {
            environments.forEach((environment) => {
                if (!allInstalledSpaces[spaceId]?.[environment] && installations.length < 20) {
                    _.set(allInstalledSpaces, `${spaceId}.${environment}`, true);
                    installations.push(
                        contentfulManager.installApp({
                            spaceId: spaceId,
                            environmentId: environment,
                            appDefinitionId: GLOBAL_SETTINGS.CF_APP_DEFINITION_ID,
                        }),
                    );
                }
            });
        });

        await Promise.allSettled(installations);

        // TODO
        // Need to check which Spaces is exist in `bigQuery` but didn't exist in Contentful anymore
        // And check that Spaces in `bigQuery`
        const spacesToUpdate: Space[] = allSpaces.map(({ spaceName, environments, createdAt }) =>
            environments.map((environment) => ({
                name: spaceName,
                environment,
                createdAt: new Date(createdAt).toISOString().slice(0, -1),
                decommissioned: 0,
            }))
        ).flat();

        _context.log("Spaces to update:", spacesToUpdate)

        await spaceListManager.updateSpaceList(spacesToUpdate);

        // Decommission spaces that no longer exist in Contentful
        // Assuming fetchedSpaces represents the spaces fetched from the BigQuery table
        const fetchedSpaces: Space[] = await spaceListManager.fetchSpacesFromBigQuery();
        fetchedSpaces.forEach(({ name, environment }) => {
            const existsInContentful = allSpaces.some(
                (contentfulSpace) => contentfulSpace.spaceId === name && contentfulSpace.environments.includes(environment)
            );
            if (!existsInContentful) {
                spaceListManager.markSpaceAsDecommissioned(name, environment);
            }
        });
    } catch (error) {
        errorHandler(error as Error);
    }
}

app.timer("spaceUpdaterTimerTrigger", {
    schedule: GLOBAL_SETTINGS.SCHEDULE,
    handler: spaceUpdaterTimerTrigger,
    runOnStartup: GLOBAL_SETTINGS.IS_RUN_ON_STARTUP,
});
