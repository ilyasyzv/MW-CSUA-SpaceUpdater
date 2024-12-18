import { ClientAPI, createClient, Space } from "contentful-management";
import axios, { AxiosInstance, HttpStatusCode } from "axios";
import _ from "lodash";
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

type GetAllSpacesResponse = Array<{
    spaceId: string;
    environments: Array<string>;
    spaceName: string;
    createdAt: string;
}>;

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

        let skipSpaces = 0;
        let totalSpaces = 0;
        let limitSpaces = 0;
        do {
            const spaces = await this.contentfulClient.getSpaces({ skip: skipSpaces + limitSpaces });
            const arSpaces: Array<Space> = spaces.items;
            const allEnvironments = await Promise.allSettled(
                arSpaces.map(async (space) => {
                    const resultEnvs: Array<string> = [];
                    let skipEnvs = 0;
                    let totalEnvs = 0;
                    let limitEnvs = 0;
                    do {
                        const environments = await space.getEnvironments({ skip: skipEnvs + limitEnvs });
                        resultEnvs.push(
                            ...environments.items
                                .map(({ sys }) =>
                                    sys?.status?.sys?.id === "ready" ? sys?.aliasedEnvironment?.sys?.id || sys?.id : "",
                                )
                                .filter((env) => env),
                        );
                        skipEnvs = environments.skip;
                        limitEnvs = environments.limit;
                        totalEnvs = environments.total;
                    } while (skipEnvs + limitEnvs < totalEnvs);

                    return _.uniq(resultEnvs);
                }),
            );

            result.push(
                ...allEnvironments.map((environments, index) => ({
                    spaceId: arSpaces[index].sys.id,
                    environments: environments.status === "fulfilled" ? environments.value : [],
                    spaceName: arSpaces[index].name,
                    createdAt: arSpaces[index].sys.createdAt,
                })),
            );

            skipSpaces = spaces.skip;
            limitSpaces = spaces.limit;
            totalSpaces = spaces.total;
        } while (skipSpaces + limitSpaces < totalSpaces);

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
                        (prev, { space, environment }) => {
                            prev[space] = prev[space] || {};
                            prev[space][environment] = true;
                            return prev;
                        },
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
