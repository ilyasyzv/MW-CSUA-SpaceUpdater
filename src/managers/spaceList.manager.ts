import { BigQuery } from "@google-cloud/bigquery";
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

    constructor(credentials: object, datasetId: string, tableId: string) {
        this.bigquery = new BigQuery({ credentials });
        this.datasetId = datasetId;
        this.tableId = tableId;
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

            console.log('Fetched spaces from BigQuery:', fetchedSpaces);
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
            console.log('Spaces to add in BigQuery', rowsToAdd);
            await table.insert(rowsToAdd);
        } catch (error) {
            errorHandler(error as Error);
        }
    }

    /**
     * Marks a specific space in a particular environment as decommissioned
     */
    public async markSpaceAsDecommissioned(spaceName: string, environment: string): Promise<void> {
        const decommissionDate = new Date().toISOString().slice(0, -1);

        const query = `
            UPDATE ${this.datasetId}.${this.tableId}
            SET decommissioned = 1,
            decommissionDate = DATETIME('${decommissionDate}')
            WHERE name = '${spaceName}' AND environment = '${environment}'
        `;

        try {
            console.log('Space marked as decommissioned in BigQuery:', { spaceName, environment });
            await this.bigquery.query({ query });
        } catch (error) {
            errorHandler(error as Error);
        }
    }
}