import { BigQuery } from "@google-cloud/bigquery";
import axios from "axios";
import { errorHandler } from "../utils/error";
import { RateLimiter } from "../utils/rateLimiter";

export interface Space {
    name: string;
    environment: string;
    createdAt: string;
    decommissioned: number;
    decommissionedDate?: string;
    presentInInventory: number;
}

export class SpaceListManager {
    private readonly bigquery: BigQuery;
    private readonly datasetId: string;
    private readonly tableId: string;
    private readonly inventoryApiUrl: string;
    private readonly inventoryAuthKey: string;

    private readonly rateLimiter: RateLimiter;

    constructor(credentials: object, datasetId: string, tableId: string, inventoryApiUrl: string, inventoryAuthKey: string) {
        this.bigquery = new BigQuery({ credentials });
        this.datasetId = datasetId;
        this.tableId = tableId;
        this.inventoryApiUrl = inventoryApiUrl;
        this.inventoryAuthKey = inventoryAuthKey;

        this.rateLimiter = new RateLimiter(1, 2000);
    }

    private async rateLimitedOperation(rateLimiter: Function): Promise<void> {
        return this.rateLimiter.addToQueue(rateLimiter);
    }

    /**
     * Fetches spaces from BigQuery and returns them
     */
    public async fetchSpacesFromBigQuery(): Promise<Space[]> {
        const query = `
            SELECT name, environment, createdAt, decommissioned, presentInInventory
            FROM \`${this.datasetId}.${this.tableId}\`
        `;

        try {
            const [job] = await this.bigquery.createQueryJob({ query });
            const [rows] = await job.getQueryResults();

            const fetchedSpaces: Space[] = rows.map((row) => ({
                name: row.name,
                environment: row.environment,
                createdAt: row.createdAt,
                decommissioned: row.decommissioned,
                presentInInventory: row.presentInInventory
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
        const table = this.bigquery.dataset(this.datasetId).table(this.tableId);
        const newSpaces = spaces.filter(({ name, environment }) => {
            return !existingSpaces.some(existingSpace =>
                existingSpace.name === name && existingSpace.environment === environment
            );
        });
    
        if (newSpaces.length === 0) {
            console.log('No new spaces to add.');
            return;
        }
    
        const rateLimiter = newSpaces.map(({ name, environment, createdAt, decommissioned, presentInInventory }) => async () => {
            try {
                await table.insert([{ name, environment, createdAt, decommissioned, presentInInventory }]);
                console.log('Space added in BigQuery', { name, environment, createdAt, decommissioned, presentInInventory });
            } catch (error) {
                errorHandler(error as Error);
            }
        });
    
        await Promise.all(rateLimiter.map((op) => this.rateLimitedOperation(op)));
    }

    /**
     * Marks a specific space in a particular environment as decommissioned
     */
    public async switchDecommissionedMark(spaceName: string, environment: string, decommissioned: number): Promise<void> {
        const rateLimiter = async () => {
            let query: string;

            if (decommissioned === 1) {
                query = `
                    UPDATE \`${this.datasetId}.${this.tableId}\`
                    SET decommissioned = 1,
                    decommissionDate = DATETIME("${new Date().toISOString().slice(0, -1)}")
                    WHERE name = "${spaceName}" AND environment = "${environment}"
                `;
            } else {
                query = `
                    UPDATE \`${this.datasetId}.${this.tableId}\`
                    SET decommissioned = 0,
                    decommissionDate = NULL
                    WHERE name = "${spaceName}" AND environment = "${environment}"
                `;
            }

            try {
                await this.rateLimitedOperation(async () => {
                    await this.bigquery.createQueryJob({ query });
                    console.log(`Space status updated in BigQuery: ${spaceName} - ${environment} - Decommissioned: ${decommissioned}`);
                });
            } catch (error) {
                errorHandler(error as Error);
            }
        };

        await rateLimiter();
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
    
            const batchSize = 20;
            const spaceChunks = [];
            for (let i = 0; i < existingSpaces.length; i += batchSize) {
                spaceChunks.push(existingSpaces.slice(i, i + batchSize));
            }
    
            for (const chunk of spaceChunks) {
                await Promise.all(chunk.map(async (existingSpace) => {
                    const foundSpace = inventorySpaces.find((inventorySpace) => {
                        return existingSpace.name === inventorySpace.name;
                    });
    
                    if (foundSpace) {
                        if (existingSpace.presentInInventory !== 1) {
                            await this.updateSpacePresentInInventory(existingSpace.name, 1);
                        }
                    } else {
                        if (existingSpace.presentInInventory !== 0) {
                            await this.updateSpacePresentInInventory(existingSpace.name, 0);
                        }
                    }
                }));
            }
        } catch (error) {
            errorHandler(error as Error);
        }
    }

    /**
     * Updates the presence status of a space in the BigQuery table.
     */
    private async updateSpacePresentInInventory(name: string, presentInInventory: number): Promise<void> {
        const rateLimiter = async () => {
            const query = `
                UPDATE \`${this.datasetId}.${this.tableId}\`
                SET presentInInventory = ${presentInInventory}
                WHERE name = "${name}"
            `;

            try {
                await this.rateLimitedOperation(async () => {
                    await this.bigquery.createQueryJob({ query });
                    console.log(`Space updated with presentInInventory status: ${name} - ${presentInInventory}`);
                });
            } catch (error) {
                errorHandler(error as Error);
            }
        };

        await rateLimiter();
    }
}