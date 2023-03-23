export const CYCLES = {
    DEV: 'dev',
    PROD: 'prod',
    STAGED: 'staged'
};

export const CYCLE = process.env.FUNCTIONS_EMULATOR ? CYCLES.DEV : (process.env.GCLOUD_PROJECT === 'shoutoutsdev-38a1d' ? CYCLES.STAGED : CYCLES.PROD);

export const CREDENTIALS = {
    EXTENSION_VERSION: process.env.EXTENSION_VERSION as string,
    EXTENSION_OWNER_ID: process.env.EXTENSION_VERSION as string,
    EXTENSION_CLIENT_ID: process.env.EXTENSION_CLIENT_ID as string,
    EXTENSION_SECRET: process.env.EXTENSION_SECRET as string
};
