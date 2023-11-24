import { ClientAPI, createClient, Space } from "contentful-management";
import set from "lodash/fp/set";
import axios, { AxiosInstance, HttpStatusCode } from "axios";
import { GLOBAL_SETTINGS } from "../config/app.constants";
import { errorHandler } from "../utils/error";

interface InstallAppArgs {
    spaceId: string;
    environmentId: string;
    appDefinitionId: string;
}

interface GetAllAppInstallationsResponse {
    items: Array<object>;
}

type GetAllSpacesResponse = Array<{ spaceId: string; environments: Array<string>; spaceName: string; createdAt: string }>;

export class ContentfulManager {
    private readonly client: AxiosInstance;
    private readonly contentfulClient: ClientAPI;

    constructor(accessToken: string) {
        const baseURL = `https://${GLOBAL_SETTINGS.CF_API_URL}`;
        const headers = {
            Authorization: `Bearer ${accessToken || GLOBAL_SETTINGS.CF_CONTENT_MANAGEMENT_API_KEY}`,
            "Content-Type": "application/vnd.contentful.management.v1+json",
        };

        this.client = axios.create({ baseURL, headers, timeout: GLOBAL_SETTINGS.AXIOS_TIMEOUT });

        this.contentfulClient = createClient({
            accessToken: accessToken,
            timeout: GLOBAL_SETTINGS.AXIOS_TIMEOUT,
            retryLimit: 100,
        });
    }

    /**
     * generate structure with all `Spaces` and all `Environments`
     */
    public async getAllSpaces(): Promise<GetAllSpacesResponse> {
        const result: GetAllSpacesResponse = [];

        let skip = 0;
        let total = 0;
        let limit = 0;
        do {
            const spaces = await this.contentfulClient.getSpaces({ skip: skip + limit });
            const arSpaces: Array<Space> = spaces.items;
            const allEnvironments = await Promise.allSettled(
                arSpaces.map((space) =>
                    space.getEnvironments().then(({ items: arEnvironment }) => arEnvironment.map(({ sys }) => sys.id)),
                ),
            );

            result.push(
                ...allEnvironments.map((environments, index) => ({
                    spaceId: arSpaces[index].sys.id,
                    environments: environments.status === "fulfilled" ? environments.value : [],
                    spaceName: arSpaces[index].name,
                    createdAt: arSpaces[index].sys.createdAt,
                })),
            );

            skip = spaces.skip;
            limit = spaces.limit;
            total = spaces.total;
        } while (skip + limit < total);

        return result;
    }

    /**
     * receive all Space-Environment pair where App was installed
     */
    public async getAllInstalledSpacesPromise(): Promise<Record<string, Record<string, boolean>>> {
        return this.contentfulClient
            .getAppDefinition({
                organizationId: GLOBAL_SETTINGS.CF_ORGANIZATION_ID,
                appDefinitionId: GLOBAL_SETTINGS.CF_APP_DEFINITION_ID,
            })
            .then((appDefinition) => appDefinition.getInstallationsForOrg())
            .then((appInstallationsForOrg) =>
                appInstallationsForOrg.items
                    .map(({ sys }) => ({ space: sys?.space?.sys?.id, environment: sys?.environment?.sys?.id }))
                    .filter(({ space, environment }) => !!space && !!environment)
                    .reduce(
                        (prev, { space, environment }) => set(`${space}.${environment}`, true, prev),
                        {} as Record<string, Record<string, boolean>>,
                    ),
            );
    }

    public async installApp({ spaceId, environmentId, appDefinitionId }: InstallAppArgs): Promise<boolean> {
        try {
            const response = await this.client.put<GetAllAppInstallationsResponse>(
                `/spaces/${spaceId}/environments/${environmentId}/app_installations/${appDefinitionId}`,
                {},
            );
            return response.status === HttpStatusCode.Ok;
        } catch (e) {
            errorHandler(e as Error);
        }
        return false;
    }
}
