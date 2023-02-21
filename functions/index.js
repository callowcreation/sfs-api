"use strict";

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const auth = require('firebase-auth');
const jsonwebtoken = require('jsonwebtoken');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');

const CYCLES = {
    DEV: 'dev',
    PROD: 'prod',
    STAGED: 'staged'
};

const CYCLE = process.env.FUNCTIONS_EMULATOR ? CYCLES.DEV : (process.env.GCLOUD_PROJECT === 'shoutoutsdev-38a1d' ? CYCLES.STAGED : CYCLES.PROD);

const URLS = {
    DATABASE: CYCLE === CYCLES.DEV || CYCLE === CYCLES.STAGED ? process.env.STAGED_DATABASE_URL : process.env.LIVE_DATABASE_URL,
    BOT: CYCLE === CYCLES.DEV ? process.env.URLS_BOT_DEV : (CYCLE === CYCLES.STAGED ? process.env.URLS_BOT_PROD_STAGED : process.env.URLS_BOT_PROD_LIVE)
};

const CREDENTIALS = {
    EXTENSION_VERSION: process.env.EXTENSION_VERSION,
    EXTENSION_CLIENT_ID: process.env.EXTENSION_CLIENT_ID,
    EXTENSION_SECRET: process.env.EXTENSION_SECRET,
    CLIENT_ID: CYCLE === CYCLES.DEV ? process.env.DEV_CLIENT_ID : process.env.CLIENT_ID,
    CLIENT_SECRET: CYCLE === CYCLES.DEV ? process.env.DEV_CLIENT_SECRET : process.env.CLIENT_SECRET,
    REDIRECT_URI: CYCLE === CYCLES.DEV ? process.env.DEV_REDIRECT_URI : process.env.REDIRECT_URI,
};

const SERVICE_ACCOUNT = CYCLE === CYCLES.DEV || CYCLE === CYCLES.STAGED ? require('./serviceAccountKeyDev.json') : require('./serviceAccountKeyProd.json');

const botHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + (Buffer.from(CREDENTIALS.EXTENSION_CLIENT_ID + ':' + CREDENTIALS.EXTENSION_SECRET).toString('base64'))
};

const MAX_CHANNEL_SHOUTOUTS = 4;
// our tokens for pubsub expire after 30 seconds
const serverTokenDurationSec = 30;

const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(SERVICE_ACCOUNT),
    databaseURL: URLS.DATABASE
});

const app = express();

app.use(cors({ origin: true }));

app.post('/v3/api/user', async (req, res) => {
    try {
        await admin.auth().createUser({
            email: req.body.email,
            uid: req.body.id,
            displayName: req.body.display_name
        });
    } catch (error) {
        if (error.message) {
            const msgs = [
                'The email address is already in use by another account.',
                'The user with the provided uid already exists.'
            ];
            if (!msgs.includes(error.message)) {
                res.status(500).json(error.message);
                return;
            }
        }
    }

    try {
        const token = await admin.auth().createCustomToken(req.body.id, req.body);
        res.json(token);
    } catch (error) {
        res.status(500).json(error.message ? error.message : 'Create Custom Token Failed');
    }
});

app.delete('/v3/api/user', async (req, res) => {
    try {
        const idToken = req.headers.authorization.substring('Bearer '.length);
        const decoded = await admin.auth().verifyIdToken(idToken, true);
        await admin.auth().deleteUser(decoded.id);
        res.status(204).end();
    } catch (error) {
        if (error.message && error.message != 'There is no user record corresponding to the provided identifier.') {
            res.status(500).json(error.message ? error.message : 'Delete User Failed');
        } else {
            res.status(403).send(error.message ? error.message : 'Action Forbidden');
        }
    }
});

// app.get('/v3/api/embedded/random', async (req, res) => {
//     const ids = await getChannelIds();
//     shuffle(ids);
//     res.status(200).json({ id: ids[0] });
// });


app.get('/v3/api/embedded', async (req, res) => {

    try {
        const ids = await getChannelIds();
        shuffle(ids);
        let retries = 0;
        while (++retries < 10) {
            const id = ids.pop();
            const settings = await getChannelSettings(id);
            if (settings) {

                const shoutouts = arrayFromVal(await getChannelShoutouts(id));
                if (shoutouts.length === 0) continue;

                const users = [];
                users.push(`id=${id}`);
                users.push(...shoutouts.map(x => `login=${x}`));
                const { data } = await sendBotRequest(`${URLS.BOT}/users`, 'POST', { users });

                const featured = data.shift();
                const posted_bys = await getPostedBys(id);

                const guests = [];
                for (let i = 0; i < shoutouts.length; i++) {
                    const user = data.find(x => x.login === shoutouts[i]);
                    if (!user) continue;
                    user.posted_by = posted_bys[user.login];
                    guests.push(user);
                }

                if (guests.length === 0) continue;

                res.status(200).json({ featured, settings, guests, retries });
                return;
            }
        }
        res.status(404).json({ user: null, settings: null, guests: [], retries });
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: { message: 'ShoutoutsForStreamers bot may be offline' } });
    }
});

app.get('/v3/api/common/:id', async (req, res) => {
    const keys = Object.keys(req.query);

    const payload = {};
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];

        switch (key) {
            case 'settings': {
                const settings = await getChannelSettings(req.params.id);
                payload[key] = settings;
            } break;
            case 'featured': {
                const users = [];
                users.push(`id=${req.params.id}`);
                const { data } = await sendBotRequest(`${URLS.BOT}/users`, 'POST', { users });
                const featured = data.shift();
                payload[key] = featured;
            } break;
            case 'guests': {
                const shoutouts = arrayFromVal(await getChannelShoutouts(req.params.id));
                if (shoutouts.length === 0) continue;

                const users = [];
                users.push(...shoutouts.map(x => `login=${x}`));
                const { data } = await sendBotRequest(`${URLS.BOT}/users`, 'POST', { users });

                const posted_bys = await getPostedBys(req.params.id);

                const guests = [];
                for (let i = 0; i < shoutouts.length; i++) {
                    const user = data.find(x => x.login === shoutouts[i]);
                    if (!user) continue;
                    user.posted_by = posted_bys[user.login];
                    guests.push(user);
                }
                payload[key] = guests;
            } break;
            case 'statistics': {

                await migrateLegacyStats(req.params.id)
                    .catch(e => console.error(e));

                const statistics = await admin.firestore().collection('stats')
                    .where('broadcaster_id', '==', req.params.id)
                    .get()
                    .then(snap => snap.docs.map(x => x.data()))
                    .then(records => {

                        const streamers = records.reduce((acc, item) => {
                            let idx = acc.findIndex(x => x.streamer_id == item.streamer_id);
                            if (idx === -1) {
                                acc.push({ legacy: item.legacy, streamer_id: item.streamer_id, total: 0 });
                                idx = acc.length - 1;
                            }
                            acc[idx].total++;
                            return acc;
                        }, []);

                        const posters = records.reduce((acc, item) => {
                            let idx = acc.findIndex(x => x.poster_id == item.poster_id);
                            if (idx === -1) {
                                acc.push({ legacy: item.legacy, poster_id: item.poster_id, total: 0 });
                                idx = acc.length - 1;
                            }
                            acc[idx].total++;
                            return acc;
                        }, []);

                        const firsts = records.reduce((acc, item) => {
                            let idx = acc.findIndex(x => x.poster_id == item.poster_id);
                            if (idx === -1) {
                                acc.push({ legacy: item.legacy, poster_id: item.poster_id, streamer_id: item.streamer_id, timestamp: item.timestamp });
                                idx = acc.length - 1;
                            }

                            if (acc[idx].timestamp > item.timestamp) {
                                acc[idx].streamer_id = item.streamer_id;
                                acc[idx].timestamp = item.timestamp;
                            }

                            return acc;
                        }, []);

                        const recents = records.reduce((acc, item) => {
                            let idx = acc.findIndex(x => x.poster_id == item.poster_id);
                            if (idx === -1) {
                                acc.push({ legacy: item.legacy, poster_id: item.poster_id, streamer_id: item.streamer_id, timestamp: item.timestamp });
                                idx = acc.length - 1;
                            }

                            if (acc[idx].timestamp < item.timestamp) {
                                acc[idx].streamer_id = item.streamer_id;
                                acc[idx].timestamp = item.timestamp;
                            }

                            return acc;
                        }, []);

                        return { streamers, posters, firsts, recents };
                    });
                payload[key] = statistics;
            } break;

            default:
                break;
        }
    }

    res.status(200).json(payload);
});

app.get('/v3/api/products', async (req, res) => {
    try {
        const idToken = req.headers.authorization.substring('Bearer '.length);
        await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
        res.status(403).send(error.message ? error.message : 'Action Forbidden');
        return;
    }

    const products = await getProducts();
    res.status(200).json({ products });
});

app.get('/v3/api/configuration', async (req, res) => {
    try {
        const idToken = req.headers.authorization.substring('Bearer '.length);
        await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
        res.status(403).send(error.message ? error.message : 'Action Forbidden');
        return;
    }

    const shoutouts = arrayFromVal(await getChannelShoutouts(id));
    if (shoutouts.length === 0) {
        res.status(404).end();
        return;
    }

    const users = [];
    users.push(`id=${id}`);
    users.push(...shoutouts.map(x => `login=${x}`));
    const { data } = await sendBotRequest(`${URLS.BOT}/users`, 'POST', { users });

    const posted_bys = await getPostedBys(id);

    const guests = [];
    for (let i = 0; i < shoutouts.length; i++) {
        const user = data.find(x => x.login === shoutouts[i]);
        if (!user) continue;
        user.posted_by = posted_bys[user.login];
        guests.push(user);
    }

    res.status(200).json({ guests });
});

app.delete('/v3/api/shoutouts', async (req, res) => {
    try {
        const idToken = req.headers.authorization.substring('Bearer '.length);
        const decoded = await admin.auth().verifyIdToken(idToken, true);
        const usernames = Object.values(req.query);
        usernames.forEach(async username => {
            await getPostedBysRef(decoded.id).child(username).remove();
            await deleteChannelShoutout(decoded.id, username);
        });

        const timestamp = Date.now();
        const shoutouts = await getChannelShoutouts(decoded.id);

        const payload = {
            shoutoutResponse: {
                usernames,
                add: false,
                timestamp
            },
            shoutoutsResponse: {
                shoutouts: arrayFromVal(shoutouts)
            }
        };

        await sendToPubsub(payload, decoded.id);

        res.status(204).end();
    } catch (error) { // Fix: Not all errors are 403
        res.status(403).send(error.message ? error.message : 'Action Forbidden');
        return;
    }
});

app.get('/v3/api/dashboard/:broadcaster_id', async (req, res) => {

    const shoutouts = arrayFromVal(await getChannelShoutouts(req.params.broadcaster_id));
    if (shoutouts.length === 0) {
        res.status(404).json({ guests: [] });
    }
    const posted_bys = await getPostedBys(req.params.broadcaster_id);

    const posters = Object.values(posted_bys);
    const users = [...shoutouts.map(x => `login=${x}`), ...posters.map(x => `login=${x}`)];
    const { data } = await sendBotRequest(`${URLS.BOT}/users`, 'POST', { users });

    await migrateLegacyStats(req.params.broadcaster_id)
        .catch(e => console.error(e));
    const col = admin.firestore().collection('stats');

    const guests = [];
    for (let i = 0; i < shoutouts.length; i++) {
        const streamer = data.find(x => x.login === shoutouts[i]);
        if (!streamer) continue;

        const poster = data.find(x => x.login === posted_bys[streamer.login]);
        if (!poster) continue;

        const posted = await col
            .where('broadcaster_id', '==', req.params.broadcaster_id)
            .where('streamer_id', '==', streamer.id)
            .where('poster_id', '==', poster.id)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get()
            .then(snap => ({ login: poster.login, display_name: poster.display_name, timestamp: snap.docs[0].data().timestamp }));
        streamer.posted = posted;
        guests.push(streamer);
    }

    res.status(200).json({ guests });
});

// Coming from Bot request
app.get('/v3/channels/commands/:id', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {
        try {
            const commands = await getChannelCommands(req.params.id);
            if (commands.length === 0) {
                commands.push(...['so', 'shoutout']);
            }
            res.json({ commands });
        } catch (error) {
            res.status(500).json({ success: false, body: req.body });
        }
    } else {
        res.status(401).json({ success: false, body: req.body });
    }
});

app.get('/v3/channels/behaviours/:id', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {
        try {
            const settings = await getChannelSettings(req.params.id);
            if (!settings.commands) settings.commands = [];
            if (settings.commands.length === 0) {
                settings.commands.push(...['so', 'shoutout']);
            }

            res.json({
                'auto-shoutouts': settings['auto-shoutouts'],
                'badge-vip': settings['badge-vip'],
                'commands': settings.commands
            });

        } catch (error) {
            res.status(500).json({ success: false, body: req.body });
        }
    } else {
        res.status(401).json({ success: false, body: req.body });
    }
});

app.get('/channels/ids', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {
        try {
            const ids = await getChannelIds();
            res.json({ ids });
        } catch (error) {
            res.status(500).json({ success: false, body: req.body });
        }
    } else {
        res.status(401).json({ success: false, body: req.body });
    }
});

// Coming from Bot request
app.post('/channels/shoutouts/add', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {
        await createStat({ broadcaster_id: req.body.channelId, streamer_id: req.body.streamer_id, poster_id: req.body.poster_id });
        await channelAddShoutout(req.body);
        res.end();
    } else {
        res.status(401).end();
    }
});

// Coming from Bot request ???? Why ???? might be v1 endpoint
app.post('/channels/settings', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {
        const settings = await getChannelSettings(req.body.channelId);
        res.json({ settings });
    } else {
        res.status(401).end();
    }
});

// Coming from Bot request
app.post('/channels/remove', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {

        //await getAllChannelsRef().child(req.body.channelId).remove();

        const idsRef = globalChannelIdsRef();

        const value = await idsRef.orderByValue().equalTo(req.body.channelId).once('value').then(snap => snap.val());
        if (value) {
            const key = Object.keys(value)[0];
            await idsRef.child(key).remove();
        }

        res.end();
    } else {
        res.status(401).end();
    }
});

// Coming from Bot request
app.get('/key-store/tokens', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {
        try {
            const snapshot = await getKeyStoreRef().once('value');
            const tokens = snapshot.val();
            res.json(tokens);
        } catch (error) {
            res.status(500).json({ success: false, body: req.body });
        }
    } else {
        res.status(401).json({ success: false, body: req.body });
    }
});

// Coming from Bot request
app.post('/key-store/tokens', async (req, res) => {
    if (verifyAuthorization({ headers: req.headers })) {

        const keyStoreRef = getKeyStoreRef();
        await keyStoreRef.update(req.body);

        res.end();
    } else {
        res.status(401).end();
    }
});

// v2 endpoints - START
app.get('/v2/bot/join', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        const channelId = verified.channelId;
        try {
            await migrateLegacyStats(channelId)
                .catch(e => console.error(e));
            await addChannelToIds(channelId);
            await sendJoinChannel(channelId);
        } catch (error) {
            console.error({ error: error.message });
        }
    }
    res.end();
});

// used to get all the ids from each channel and put them in a seperate table
// endpoint used for the bot
app.get('/v2/channels/names', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    const ref = await getAllChannelsRef();
    const channelIds = await ref.once('value').then(snap => snap.val());
    const ids = makeChannelIdsArray(channelIds);
    const idsRef = globalChannelIdsRef();
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        await migrateLegacyStats(id)
            .catch(e => console.error(e));
        await addChannelToIds(id, idsRef);
    }
    res.end();
});

app.get('/v2/settings', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        const channelId = verified.channelId;
        const settings = await getChannelSettings(channelId);

        try {
            await migrateLegacyStats(channelId)
                .catch(e => console.error(e));
            await addChannelToIds(channelId);
            await sendJoinChannel(channelId);
            const data = {
                settings: settings || getDefaultSettings()
            };
            res.json(data);
        } catch (error) {
            res.json({ error: error.message });
            console.error(error);
        }

    } else {
        res.json({
            settings: getDefaultSettings()
        });
    }
});

app.get('/v2/shoutouts', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        const channelId = verified.channelId;
        const posted_bys = await getPostedBys(channelId);
        const shoutouts = arrayFromVal(await getChannelShoutouts(channelId));

        const pinned = await getPinToTopRef(channelId).once('value').then(snap => snap.val());
        res.json({ shoutouts, posted_bys, pinned });
    } else {
        res.json({ shoutouts: [], posted_bys: [], pinned: null });
    }
});

app.post('/v2/channels/delete', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    await channelDeleteShoutout({ headers: req.headers, body: req.body });
    res.end();
});

app.post('/v2/channels/settings', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    await updateChannelSettings({ headers: req.headers, body: req.body });
    res.end();
});

app.post('/v2/users', async (req, res) => {
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        try {
            const users = req.body.usernames.map(x => `login=${x}`);
            const result = await sendBotRequest(`${URLS.BOT}/users`, 'POST', { users });
            res.json(result.data);
        } catch (error) {
            console.error({ error: error.message });
            res.status(500).end();
        }
    } else {
        res.status(401).end();
    }
});
// v2 endpoints - END

// v3 endpoints - START
app.post('/v3/bits/move-up', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');

    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        const channelId = verified.channelId;
        try {
            //const receiptPayload = verifyAndDecodeTransaction(req.body.transaction.transactionReceipt);
            // save tx data to db
            //console.log(receiptPayload);

            const moveUpRef = getMoveUpRef(channelId);

            const timestamp = serverTimestamp();
            await moveUpRef.set({ timestamp });
            const moved_ts = (await moveUpRef.child('timestamp').get()).val();

            const posted_bys = await getPostedBys(channelId);

            // const shoutoutsArray = await moveToChannelShoutout(channelId, req.body.username);

            const result = await sendToPubsub({
                transactionResponse: {
                    type: 'move-up',
                    username: req.body.username,
                    posted_by: posted_bys[req.body.username],
                    timestamp: moved_ts
                }
            }, channelId);
            console.log({ result });
        } catch (error) {
            console.error({ error: error.message });

            await sendToPubsub({
                transactionResponse: {
                    type: 'move-up',
                    username: req.body.username,
                    posted_by: null,
                    timestamp: Date.now()
                },
                error: error.message
            }, channelId);
        }
        res.end();
    } else {
        console.error({ error: 'Invalid token for move request' });
        res.status(401).json(null);
    }
});

app.post('/v3/bits/move-up-expired', async (req, res) => {
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {

        const moveUpRef = getMoveUpRef(verified.channelId);

        const numChildren = (await moveUpRef.once('value')).numChildren();
        if (numChildren > 0) {
            await moveUpRef.remove();

            const message = {
                actionResponse: {
                    ...verified
                }
            };
            const result = await sendToPubsub(message, verified.channelId);
            console.log({ result });
        }

        res.end();
    } else {
        console.error({ error: 'Invalid token for pin request' });
        res.status(401).json(null);
    }
});

app.post('/v3/bits/pin-to-top', async (req, res) => {
    //res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        const channelId = verified.channelId;
        try {
            //const receiptPayload = verifyAndDecodeTransaction(req.body.transaction.transactionReceipt);
            // save tx data to db
            //console.log(receiptPayload);

            const pinToTopRef = getPinToTopRef(channelId);
            const posted_bys = await getPostedBys(channelId);

            const timestamp = serverTimestamp();
            const data = {
                timestamp,
                username: req.body.username,
                posted_by: posted_bys[req.body.username],
            };
            await pinToTopRef.set(data);

            const pinned_ts = (await pinToTopRef.child('timestamp').get()).val();

            await getPostedBysRef(channelId).child(req.body.username).remove();
            await deleteChannelShoutout(channelId, req.body.username);

            await sendToPubsub({
                transactionResponse: {
                    type: 'pin-to-top',
                    username: data.username,
                    posted_by: data.posted_by,
                    timestamp: pinned_ts
                }
            }, channelId);
        } catch (error) {
            console.error({ error: error.message });

            await sendToPubsub({
                transactionResponse: {
                    type: 'pin-to-top',
                    username: req.body.username,
                    posted_by: null,
                    timestamp: Date.now()
                },
                error: error.message
            }, channelId);
        }
        res.end();
    } else {
        console.error({ error: 'Invalid token for pin request' });
        res.status(401).json(null);
    }
});

app.post('/v3/bits/pin-to-top-expired', async (req, res) => {
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {

        const pinToTopRef = getPinToTopRef(verified.channelId);

        const numChildren = (await pinToTopRef.once('value')).numChildren();
        if (numChildren > 0) {
            await pinToTopRef.remove();

            await channelAddShoutout({ channelId: verified.channelId, username: req.body.username, posted_by: req.body.posted_by, is_auto: false });
        }

        res.end();
    } else {
        console.error({ error: 'Invalid token for pin request' });
        res.status(401).json(null);
    }
});

app.post('/v3/products', async (req, res) => {
    const verified = verifyAndGetIds({ headers: req.headers });
    if (verified) {
        const productsRef = globalProductsRef();
        await productsRef.set(req.body.products);
        res.end();
    } else {
        console.error({ error: 'Invalid token for pin request' });
        res.status(401).json(null);
    }
});

// v3 endpoints - END

async function getChannelIds() {
    const ids = [];
    const snapshot = await globalChannelIdsRef().once('value');
    snapshot.forEach(child => {
        const id = child.val();
        ids.push(id);
    });
    return ids;
}

async function getProducts() {
    const products = [];
    const snapshot = await globalProductsRef().once('value');
    snapshot.forEach(child => {
        const product = child.val();
        products.push(product);
    });
    return products;
}

async function getChannelCommands(channelId) {
    const commands = [];
    const snapshot = await getChannelCommandsRef(channelId).once('value');
    snapshot.forEach(child => {
        const command = child.val();
        commands.push(command);
    });
    return commands;
}

function getDefaultSettings() {
    return {
        'background-color': '#6441A5',
        'border-color': '#808080',
        'color': '#FFFFFF',
        'auto-shoutouts': false,
        'enable-bits': true,
        'bits-tier': 'Tier 1',
        'pin-days': 3,
        'badge-vip': true,
        'commands': ['so', 'shoutout']
    };
}

async function moveToChannelShoutout(channelId, username) {
    try {
        const shoutoutsRef = getChannelShoutoutsRef(channelId);
        const shoutouts = await getChannelShoutouts(channelId, shoutoutsRef);
        const shoutoutsArray = arrayFromVal(shoutouts);
        shoutoutsArray.reverse(); // reverse to put in the order stored in the database
        const itemToMove = shoutoutsArray.find(x => x === username);
        const fromIndex = shoutoutsArray.indexOf(itemToMove);
        const shoutout = shoutoutsArray[fromIndex - 1];
        shoutoutsArray[fromIndex - 1] = shoutoutsArray[fromIndex];
        shoutoutsArray[fromIndex] = shoutout;

        try {
            await shoutoutsRef.remove();
            shoutoutsArray.reverse(); // reverse to put in the order expected by the frontend
            for (let i = 0; i < shoutoutsArray.length; i++) {
                await shoutoutsRef.push(shoutoutsArray[i]);
            }
        } catch (err) {
            console.error(err);
        }

        return shoutoutsArray;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

async function addChannelToIds(channel_id, ids_ref = null) {
    if (!ids_ref) {
        ids_ref = globalChannelIdsRef();
    }
    const channelId = await ids_ref.orderByValue().equalTo(channel_id).once('value').then(snap => snap.val());
    if (!channelId) {
        await ids_ref.push(channel_id);
    }
}

async function migrateLegacyStats(broadcaster_id) {

    const stats = await getChannelStats(broadcaster_id);
    if (!stats) return;

    const statsCollection = admin.firestore().collection('stats');

    try {
        for (const streamer in stats) {
            for (const poster in stats[streamer]) {
                for (const key in stats[streamer][poster]) {
                    const timestamp = stats[streamer][poster][key];
                    const stat = { legacy: true, broadcaster_id, streamer_id: streamer, poster_id: poster, timestamp };
                    await statsCollection.add(stat);
                    await getStatsRef(broadcaster_id).child(`${streamer}/${poster}/${key}`).remove();
                }
            }
        } 
    } catch (e) {
        console.error(`Cound not create entry for ${broadcaster_id}`, e);
        throw e;
    }

}

async function sendJoinChannel(channelId) {
    await sendBotRequest(`${URLS.BOT}/join`, 'POST', { channelId });
}

async function sendBotRequest(url, method, data = null) {
    const options = {
        method,
        headers: botHeaders
    };
    if (data) options.body = JSON.stringify(data);
    return fetch(url, options).then(r => r.json());
}

async function createStat({ broadcaster_id, streamer_id, poster_id }) {
    return admin.firestore().collection('stats')
        .add({
            legacy: false,
            broadcaster_id,
            streamer_id,
            poster_id,
            timestamp: serverTimestamp()
        });
}

async function channelAddShoutout({ channelId, username, posted_by, is_auto }) {

    /*
    const anthonywritescode = {
        "naivebot": [1589411074823, 1589411093848],
        "callowcreation": [1589411242460]
    };
    */
    if (is_auto === true) {
        const settings = await getChannelSettings(channelId);
        if (settings['auto-shoutouts'] === false) return;
    }

    const shoutoutsRef = getChannelShoutoutsRef(channelId);
    const shoutouts = await getChannelShoutouts(channelId, shoutoutsRef);

    for (const key in shoutouts) {
        if (shoutouts[key].toLowerCase() === username) {
            await shoutoutsRef.child(key).remove();
            break;
        }
    }

    const pinToTopRef = getPinToTopRef(channelId);
    const pinnedItem = await pinToTopRef.once('value').then(snap => snap.val());

    if (pinnedItem) {
        if (pinnedItem.username !== username) {
            await shoutoutsRef.push(username);
        }
    } else {
        await shoutoutsRef.push(username);
    }

    const snapshot = await shoutoutsRef.once('value');
    const numChildren = snapshot.numChildren();
    const difference = numChildren - MAX_CHANNEL_SHOUTOUTS;
    if (difference > 0) {
        const firstsnap = await shoutoutsRef.limitToFirst(difference).once('value');
        firstsnap.forEach(async csnap => {
            await shoutoutsRef.child(csnap.key).remove();
        });
    }

    // new for smaller data send to pubsub
    const channelShoutouts = await getChannelShoutouts(channelId);
    const shoutoutsArray = arrayFromVal(channelShoutouts);


    const posted_bys_ref = getPostedBysRef(channelId);
    const posted_bys = await getPostedBys(channelId, posted_bys_ref);

    for (const key in posted_bys) {
        if (key.toLowerCase() === username) {
            await posted_bys_ref.child(key).remove();
            break;
        }
    }

    await posted_bys_ref.child(username).set(posted_by);

    const firstsnap = await posted_bys_ref.once('value').then(snap => snap.val());
    const data = {};
    for (const key in firstsnap) {
        if (shoutoutsArray.includes(key)) {
            data[key] = firstsnap[key];
        }
    }
    posted_bys_ref.set(data);

    const postedBys = {};
    for (let i = 0; i < shoutoutsArray.length; i++) {
        const shoutout = shoutoutsArray[i];
        postedBys[shoutout] = posted_bys[shoutout];
    }

    const message = {
        shoutoutResponse: {
            usernames: [username],
            posted_by: posted_by,
            add: true,
            max_count: MAX_CHANNEL_SHOUTOUTS,
            timestamp: serverTimestamp()
        }
    };
    const result = await sendToPubsub(message, channelId);

    //console.log(`Send add user (${username}) to extension status ${result.status === 204 ? 'SUCCESS' : 'FAILED: ' + result.status}`);
    //console.log(`---- (${username} ${result.status}) message to string ${JSON.stringify(message)}`);
}

async function channelDeleteShoutout({ headers, body }) {
    const verified = verifyAndGetIds({ headers });
    if (verified) {
        const timestamp = Date.now();
        const channelId = verified.channelId;
        await getPostedBysRef(channelId).child(body.username).remove();
        await deleteChannelShoutout(channelId, body.username);
        const shoutouts = await getChannelShoutouts(channelId);
        const shoutoutsArray = arrayFromVal(shoutouts);
        await sendToPubsub({
            shoutoutResponse: {
                usernames: [body.username],
                add: false,
                timestamp
            },
            shoutoutsResponse: {
                shoutouts: shoutoutsArray
            }
        }, channelId);
    } else {

    }
}

async function updateChannelSettings({ headers, body }) {
    const verified = verifyAndGetIds({ headers });
    if (verified) {
        const channelId = verified.channelId;
        try {
            await migrateLegacyStats(channelId)
                .catch(e => console.error(e));
            await addChannelToIds(channelId);
            await sendJoinChannel(channelId);
        } catch (error) {
            console.error({ error: error.message });
        }
        await getChannelSettingsRef(channelId).update(body.settings);
        //await sendToPubsub({ settingsResponse: { settings: body.settings } }, channelId);
    }
}

function arrayFromVal(val) {
    if (!val) return [];
    return Object.values(val);
}

function makeChannelIdsArray(channelIds) {
    const data = [];
    for (const key in channelIds) {
        if (key === 'channel_id') continue;
        data.push(key);
    }
    return data;
}

async function deleteChannelShoutout(channelId, username) {
    const shoutouts = await getChannelShoutouts(channelId);
    let ref = null;
    for (const key in shoutouts) {
        if (username === shoutouts[key]) {
            ref = getChannelShoutoutsRef(channelId).child(key);
            break;
        }
    }
    return ref ? ref.remove() : null;
}

async function getChannel(channelId, defaultValue) {
    const snap = await firebaseApp.database().ref(`${channelId}`).once('value');
    return snap.val() || defaultValue
}

function getChannelSettings(channelId) {
    return getChannelSettingsRef(channelId)
        .once('value')
        .then(snap => snap.val());
}

function getChannelStats(channelId) {
    return getStatsRef(channelId)
        .once('value')
        .then(snap => snap.val());
}

/**
 * 
 * @param {string} channelId the channel id where the bits transaction originated
 * @param {Reference} ref if omitted or null a reference (ref) will be created
 * @returns a key value Object containing all the posted bys
 */
function getPostedBys(channelId, ref = null) {
    if (!ref) ref = getPostedBysRef(channelId);
    return ref
        .once('value')
        .then(snap => snap.val());
}

/**
 * 
 * @param {string} channelId the channel id 
 * @param {Reference} ref if omitted or null a reference (ref) will be created
 * @returns 
 */
function getChannelShoutouts(channelId, ref = null) {
    if (!ref) ref = getChannelShoutoutsRef(channelId);
    return getChannelShoutoutsRef(channelId)
        .once('value')
        .then(snap => snap.val());
}

function getAllChannelsRef() {
    return firebaseApp.database().ref(`/`);
}

// function getAllChannelIdsRef() {
//     return firebaseApp.database().ref(`/channel_id`);
// }

function getChannelCommandsRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/commands`);
}

function getPostedBysRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/posted_by`);
}

function getChannelShoutoutsRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/shoutouts`);
}

function getChannelSettingsRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/settings`);
}

function getMoveUpRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/move-up`);
}

function getPinToTopRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/pin-to-top`);
}

function getStatsRef(channelId) {
    return firebaseApp.database().ref(`${channelId}/stats`);
}

function globalChannelIdsRef() {
    return firebaseApp.database().ref(`_global/v3/channel_id`);
}

function globalProductsRef() {
    return firebaseApp.database().ref(`_global/v3/products`);
}

function getKeyStoreRef() {
    return firebaseApp.database().ref(`/key-store/tokens`);
}

function serverTimestamp() {
    return Date.now();
}

function verifyAuthorization({ headers }) {
    return headers['authorization'] === 'Basic ' + (Buffer.from(CREDENTIALS.EXTENSION_CLIENT_ID + ':' + CREDENTIALS.EXTENSION_SECRET).toString('base64'));
}

function verifyAndGetIds({ headers }) {
    try {
        const payload = verifyAndDecode(headers.authorization);
        const { channel_id: channelId, opaque_user_id: opaqueUserId } = payload;
        return { channelId, opaqueUserId };
    } catch (error) {
        console.error('-------> eRRor !!!!!!!!!!!!!! ', headers, error);
    }
}

// Verify the header and the enclosed JWT.
function verifyAndDecode(header) {
    const bearerPrefix = 'Bearer ';
    if (header && header.startsWith(bearerPrefix)) {
        try {
            const token = header.substring(bearerPrefix.length);
            const extension_secret = Buffer.from(CREDENTIALS.EXTENSION_SECRET, 'base64');
            return jsonwebtoken.verify(token, extension_secret, { algorithms: ['HS256'] });
        } catch (ex) {
            console.error('invalid_auth_header', ex);
        }
    }
}

// Verify the bits transaction and the enclosed JWT.
function verifyAndDecodeTransaction(transactionReceipt) {
    if (transactionReceipt) {
        try {
            const extension_secret = Buffer.from(CREDENTIALS.EXTENSION_SECRET, 'base64');
            return jsonwebtoken.verify(transactionReceipt, extension_secret, { algorithms: ['HS256'] });
        } catch (ex) {
            throw ex;
        }
    }
}

function makeServerToken(channelId) {
    const payload = {
        exp: Math.floor(Date.now() / 1000) + serverTokenDurationSec,
        channel_id: channelId,
        user_id: CREDENTIALS.EXTENSION_OWNER_ID,
        role: 'external',
        pubsub_perms: {
            send: ['broadcast'],
        }
    };
    const extension_secret = Buffer.from(CREDENTIALS.EXTENSION_SECRET, 'base64');
    return jsonwebtoken.sign(payload, extension_secret, { algorithm: 'HS256' });
}

function attachEnvironment(message) {
    message.cycle = CYCLE;
    message.version = CREDENTIALS.EXTENSION_VERSION;
    message.timestamp = Date.now();
    return message;
}

async function sendToPubsub(message, channelId) {
    try {

        const url = `https://api.twitch.tv/helix/extensions/pubsub?broadcaster_id=${channelId}`;
        const headers = {
            'Client-ID': CREDENTIALS.EXTENSION_CLIENT_ID,
            'Content-Type': "application/json",
            'Authorization': 'Bearer ' + makeServerToken(channelId)
        };
        const body = JSON.stringify({
            message: JSON.stringify(attachEnvironment(message)),
            broadcaster_id: channelId,
            target: ['broadcast'],
        });

        return fetch(url, { method: 'POST', headers, body });
    } catch (error) {
        return error;
    }
}

function shuffle(array) {
    let currentIndex = array.length, randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex != 0) {

        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }

    return array;
}

exports.app = functions.https.onRequest(app);


function updateSettings(change, context) {
    if (!change.after.exists()) return null;

    try {
        return sendToPubsub({ settingsResponse: { settings: change.after.val() } }, context.params.id);
    } catch (err) {
        console.error(err);
        return null;
    }
}

exports.updateSettings = functions.database
    .ref('/{id}/settings')
    .onUpdate(updateSettings);