import * as jsonwebtoken from 'jsonwebtoken';
import fetch from 'node-fetch';

const CYCLES = {
    DEV: 'dev',
    PROD: 'prod',
    STAGED: 'staged'
};

const CYCLE = process.env.FUNCTIONS_EMULATOR ? CYCLES.DEV : (process.env.GCLOUD_PROJECT === 'shoutoutsdev-38a1d' ? CYCLES.STAGED : CYCLES.PROD);

const CREDENTIALS = {
    EXTENSION_VERSION: process.env.EXTENSION_VERSION as string,
    EXTENSION_OWNER_ID: process.env.EXTENSION_VERSION as string,
    EXTENSION_CLIENT_ID: process.env.EXTENSION_CLIENT_ID as string,
    EXTENSION_SECRET: process.env.EXTENSION_SECRET as string
};

// our tokens for pubsub expire after 30 seconds
const SERVER_TOKEN_TTL_SECONDS: number = 30;

function makeServerToken(broadcaster_id: string): string {
    const payload = {
        exp: Math.floor(Date.now() / 1000) + SERVER_TOKEN_TTL_SECONDS,
        channel_id: broadcaster_id,
        user_id: CREDENTIALS.EXTENSION_OWNER_ID,
        role: 'external',
        pubsub_perms: {
            send: ['broadcast'],
        }
    };
    const extension_secret = Buffer.from(CREDENTIALS.EXTENSION_SECRET, 'base64');
    return jsonwebtoken.sign(payload, extension_secret, { algorithm: 'HS256' });
}

function attachEnvironment(payload: any): any {
    payload.cycle = CYCLE;
    payload.version = CREDENTIALS.EXTENSION_VERSION;
    payload.timestamp = Date.now();
    return payload;
}

export async function send(payload: any, broadcaster_id: string) {
    try {

        const url = `https://api.twitch.tv/helix/extensions/pubsub?broadcaster_id=${broadcaster_id}`;
        const headers = {
            'Client-ID': CREDENTIALS.EXTENSION_CLIENT_ID,
            'Content-Type': "application/json",
            'Authorization': 'Bearer ' + makeServerToken(broadcaster_id)
        };
        const body = JSON.stringify({
            message: JSON.stringify(attachEnvironment(payload)),
            broadcaster_id: broadcaster_id,
            target: ['broadcast'],
        });

        return fetch(url, { method: 'POST', headers, body });
    } catch (error) {
        return error;
    }
}