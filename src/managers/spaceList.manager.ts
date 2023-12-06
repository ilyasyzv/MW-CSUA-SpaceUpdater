import { BigQuery } from "@google-cloud/bigquery";
import axios from "axios";
import { errorHandler } from "../utils/error";

export interface Space {
    name: string;
    environment: string;
    createdAt: string;
    decommissioned: number;
}

export class SpaceListManager {
    private readonly bigquery: BigQuery;
    private readonly datasetId: string;
    private readonly tableId: string;
    private readonly inventoryApiUrl: string;
    private readonly inventoryAuthKey: string;

    constructor(credentials: object, datasetId: string, tableId: string, inventoryApiUrl: string, inventoryAuthKey: string) {
        this.bigquery = new BigQuery({ credentials });
        this.datasetId = datasetId;
        this.tableId = tableId;
        this.inventoryApiUrl = inventoryApiUrl;
        this.inventoryAuthKey = inventoryAuthKey;
    }

    /**
     * Fetches spaces from BigQuery and returns them
     */
    public async fetchSpacesFromBigQuery(): Promise<Space[]> {
        const query = `
            SELECT name, environment, createdAt, decommissioned
            FROM ${this.datasetId}.${this.tableId}
        `;

        try {
            const [job] = await this.bigquery.createQueryJob({ query });
            const [rows] = await job.getQueryResults();

            const fetchedSpaces: Space[] = rows.map((row) => ({
                name: row.name,
                environment: row.environment,
                createdAt: row.createdAt,
                decommissioned: row.decommissioned,
            }));

            return fetchedSpaces;
        } catch (error) {
            errorHandler(error as Error);
            return [];
        }
    }

    /**
     * Updates the space list in BigQuery with the provided spaces
     */
    public async updateSpaceList(spaces: Space[]): Promise<void> {
        const existingSpaces = await this.fetchSpacesFromBigQuery();

        const rowsToAdd = spaces.filter((newSpace) => {
            return !existingSpaces.some((existingSpace) =>
                existingSpace.name === newSpace.name && existingSpace.environment === newSpace.environment
            );
        }).map(({ name, environment, createdAt, decommissioned }) => ({
            name,
            environment,
            createdAt,
            decommissioned,
        }));

        if (rowsToAdd.length === 0) {
            return;
        }

        const table = this.bigquery.dataset(this.datasetId).table(this.tableId);

        try {
            await table.insert(rowsToAdd);
            console.log('Spaces to add in BigQuery', rowsToAdd);
        } catch (error) {
            errorHandler(error as Error);
        }
    }

    /**
     * Marks a specific space in a particular environment as decommissioned
     */
    public async switchDecommissionedMark(spaceName: string, environment: string, decommissioned: number): Promise<void> {
        let query: string;

        if (decommissioned === 1) {
            query = `
                UPDATE ${this.datasetId}.${this.tableId}
                SET decommissioned = 0,
                decommissionDate = NULL
                WHERE name = '${spaceName}' AND environment = '${environment}'
            `;
        } else {
            query = `
                UPDATE ${this.datasetId}.${this.tableId}
                SET decommissioned = 1,
                decommissionDate = DATETIME('${new Date().toISOString().slice(0, -1)}')
                WHERE name = '${spaceName}' AND environment = '${environment}'
            `;
        }

        try {
            await this.bigquery.query({ query });
            console.log(`Space status updated in BigQuery: ${spaceName} - ${environment} - Decommissioned: ${decommissioned}`);
        } catch (error) {
            errorHandler(error as Error);
        }
    }

    /**
     * Marks spaces present in the Inventory API by comparing with existing spaces in BigQuery and updating their presence status.
     */
    public async markSpacesPresentInInventory(): Promise<void> {
        try {
            const response = await axios.get(this.inventoryApiUrl, {
                auth: {
                    username: "",
                    password: this.inventoryAuthKey
                }
            });

            const inventorySpaces = response.data as Array<{ name: string }>;

            const existingSpaces = await this.fetchSpacesFromBigQuery();

            existingSpaces.forEach((existingSpace) => {
                const foundSpace = inventorySpaces.find((inventorySpace) => {
                    return existingSpace.name === inventorySpace.name;
                });

                const presentInInventory = foundSpace ? 1 : 0;

                this.updateSpacePresentInInventory(existingSpace.name, presentInInventory);
            });
        } catch (error) {
            errorHandler(error as Error);
        }
    }

    /**
     * Updates the presence status of a space in the BigQuery table.
     */
    private async updateSpacePresentInInventory(name: string, presentInInventory: number): Promise<void> {
        const query = `
            UPDATE ${this.datasetId}.${this.tableId}
            SET presentInInventory = ${presentInInventory}
            WHERE name = '${name}''
        `;

        try {
            await this.bigquery.query({ query });
            console.log(`Space updated with presentInInventory status: ${name} - ${presentInInventory}`);
        } catch (error) {
            errorHandler(error as Error);
        }
    }
}