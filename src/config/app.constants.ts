import "dotenv/config";

export const GLOBAL_SETTINGS = Object.freeze({
    CF_CONTENT_MANAGEMENT_API_KEY: process.env.CF_CONTENT_MANAGEMENT_API_KEY || "",
    CF_ORGANIZATION_ID: process.env.CF_ORGANIZATION_ID || "",
    CF_APP_DEFINITION_ID: process.env.CF_APP_DEFINITION_ID || "",
    CF_API_URL: process.env.CF_API_URL || "api.contentful.com",
    IS_RUN_ON_STARTUP: process.env.IS_RUN_ON_STARTUP === "true",
    SCHEDULE: process.env.SCHEDULE || "",
    AZURE_VAULT_NAME: process.env.AZURE_VAULT_NAME || "",
    CONTENTFUL_ACCESS_TOKEN_NAME: process.env.CONTENTFUL_ACCESS_TOKEN_NAME || "",
    BIG_QUERY_TOKEN_NAME: process.env.BIG_QUERY_TOKEN_NAME || "",
    BIG_QUERY_DATASET_ID: process.env.BIG_QUERY_DATASET_ID || "",
    BIG_QUERY_TABLE_ID: process.env.BIG_QUERY_TABLE_ID || "",
    MWI_API_URL: process.env.MWI_API_URL || "",
    MWI_API_AUTH_KEY_NAME: process.env.MWI_API_AUTH_KEY_NAME || "",
    AXIOS_TIMEOUT: 600000,
});
