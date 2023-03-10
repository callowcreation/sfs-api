"use strict";

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const jsonwebtoken = require('jsonwebtoken');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');

const iStaged = true;
const production = { staged: 0, live: 1 };

const serviceAccount = iStaged
	? require("./serviceAccountKeyDev.json")
	: require("./serviceAccountKeyProd.json");

const URLS = {
    api: {
        dev: process.env.URLS_API_DEV,
        prod: [process.env.URLS_API_PROD_STAGED, process.env.URLS_API_PROD_LIVE]
    },
    bot: {
        dev: process.env.URLS_BOT_DEV,
        prod: [process.env.URLS_BOT_PROD_STAGED, process.env.URLS_BOT_PROD_LIVE]
    }
};

const databaseURL = iStaged ? URLS.api.prod[production.staged] : URLS.api.prod[production.live];

const botHeaders = {
	'Content-Type': 'application/json',
	'Authorization': 'Basic ' + (Buffer.from(process.env.EXTENSION_CLIENT_ID + ':' + process.env.EXTENSION_SECRET).toString('base64'))
};

const MAX_CHANNEL_SHOUTOUTS = 4;
// our tokens for pubsub expire after 30 seconds
const serverTokenDurationSec = 30;

const firebaseApp = admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	databaseURL
});

const app = express();

app.use(cors({ origin: true }));

// Coming from Bot request
app.get('/channels/ids', async (req, res) => {
	if (verifyAuthorization({ headers: req.headers })) {
		try {
			const ids = [];
			const snapshot = await getAllChannelsIdRef().once('value');
			snapshot.forEach(child => {
				const id = child.val();
				ids.push(id);
			});
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

		const idsRef = getAllChannelsIdRef();

		const value = await idsRef.orderByValue().equalTo(req.body.channelId).once('value').then(snap => snap.val());
		if (value) {
			const key = Object.keys(value)[0];
			//console.log({ key });
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
	const idsRef = getAllChannelsIdRef();
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i];
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

function getDefaultSettings() {
	return {
		'background-color': '#6441A5',
		'border-color': '#808080',
		'color': '#FFFFFF',
		'auto-shoutouts': false,
		'enable-bits': true,
		'bits-tier': 'Tier 1',
		'pin-days': 3
	};
}

app.get('/v2/shoutouts', async (req, res) => {
	//res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
	const verified = verifyAndGetIds({ headers: req.headers });
	if (verified) {
		const channelId = verified.channelId;
		const posted_bys = await getPostedBys(channelId);
		const shoutouts = makeShoutoutsArray(await getChannelShoutouts(channelId));

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
	//console.log(req.headers);
	const verified = verifyAndGetIds({ headers: req.headers });
	if (verified) {
		try {
			const users = req.body.usernames.map(x => `login=${x}`);
			const result = await sendBotRequest(`${makeBotUrlPath()}/users`, 'POST', { users });
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

			const timestamp = admin.database.ServerValue.TIMESTAMP;
			await moveUpRef.set({ timestamp });
			const moved_ts = (await moveUpRef.child('timestamp').get()).val();

			const posted_bys = await getPostedBys(channelId);

			const shoutoutsArray = await moveToChannelShoutout(channelId, req.body.username);

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

			const timestamp = admin.database.ServerValue.TIMESTAMP;
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
// v3 endpoints - END

async function moveToChannelShoutout(channelId, username) {
	try {
		const shoutoutsRef = getChannelShoutoutsRef(channelId);
		const shoutouts = await getChannelShoutouts(channelId, shoutoutsRef);
		const shoutoutsArray = makeShoutoutsArray(shoutouts);
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
		ids_ref = getAllChannelsIdRef();
	}
	const channelId = await ids_ref.orderByValue().equalTo(channel_id).once('value').then(snap => snap.val());
	if (!channelId) {
		await ids_ref.push(channel_id);
	}
}

async function sendJoinChannel(channelId) {
	await sendBotRequest(`${makeBotUrlPath()}/join`, 'POST', { channelId });
}

async function sendBotRequest(url, method, data = null) {
	const options = {
		method,
		headers: botHeaders
	};
	if (data) options.body = JSON.stringify(data);
	return fetch(url, options).then(r => r.json());
}

async function channelAddShoutout({ channelId, username, posted_by, is_auto }) {

	/*
	const anthonywritescode = {
		"naivebot": [1589411074823, 1589411093848],
		"callowcreation": [1589411242460]
	};
	*/
	if(is_auto === true) {
		const settings = await getChannelSettings(channelId);
		if(settings['auto-shoutouts'] === false) return;
	}
	
	const statsRef = firebaseApp.database().ref(`${channelId}/stats`);
	const timestamp = Date.now();
	await statsRef.child(`${username}/${posted_by}`).push(timestamp);

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

	/*const stats = await firebaseApp.database().ref(`${channelId}/stats`).once('value')
		.then(snap => {
			const values = [];
			snap.forEach(child => {
				const item = child.val();
				for (const username in item) {
					const keys = Object.keys(item[username]);
					const timestamps = keys.map(x => item[username][x]);
					item[username] = [...timestamps];
				}
				values[child.key] = item;
			});
			console.log(values);
			return values;
		});*/

	// new for smaller data send to pubsub
	const channelShoutouts = await getChannelShoutouts(channelId);
	const shoutoutsArray = makeShoutoutsArray(channelShoutouts);


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
	console.log({ 'local_log': data });

	const postedBys = {};
	for (let i = 0; i < shoutoutsArray.length; i++) {
		const shoutout = shoutoutsArray[i];
		postedBys[shoutout] = posted_bys[shoutout];
	}

	const message = {
		shoutoutResponse: {
			username: username,
			posted_by: posted_by,
			add: true,
			max_count: MAX_CHANNEL_SHOUTOUTS,
			timestamp
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
		const shoutoutsArray = makeShoutoutsArray(shoutouts);
		await sendToPubsub({
			shoutoutResponse: {
				username: body.username,
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
			await addChannelToIds(channelId);
			await sendJoinChannel(channelId);
		} catch (error) {
			console.error({ error: error.message });
		}
		console.log({ settings: body.settings });
		await getChannelSettingsRef(channelId).update(body.settings);
		await sendToPubsub({ settingsResponse: { settings: body.settings } }, channelId);
	}
}

function makeShoutoutsArray(shoutouts) {
	const data = [];
	for (const key in shoutouts) {
		data.push(shoutouts[key]);
	}
	return data;
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

function getAllChannelsIdRef() {
	return firebaseApp.database().ref(`/channel_id`);
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

function getKeyStoreRef() {
	return firebaseApp.database().ref(`/key-store/tokens`);
}

function verifyAuthorization({ headers }) {
	return headers['authorization'] === 'Basic ' + (Buffer.from(process.env.EXTENSION_CLIENT_ID + ':' + process.env.EXTENSION_SECRET).toString('base64'));
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
			const extension_secret = Buffer.from(process.env.EXTENSION_SECRET, 'base64');
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
			const extension_secret = Buffer.from(process.env.EXTENSION_SECRET, 'base64');
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
		user_id: process.env.EXTENSION_.owner.id,
		role: 'external',
		pubsub_perms: {
			send: ['broadcast'],
		}
	};
	const extension_secret = Buffer.from(process.env.EXTENSION_SECRET, 'base64');
	return jsonwebtoken.sign(payload, extension_secret, { algorithm: 'HS256' });
}

function getEnvironment() {
	return process.env.FUNCTIONS_EMULATOR ? 'dev' : 'prod';
}
//Julie_HomeWithMyBookshelf
function makeBotUrlPath() {
	return getEnvironment() === 'dev' ? URLS.bot.dev : iStaged ? URLS.bot[production.staged] : URLS.bot[production.live];
}

function attachEnvironment(message) {
	message.environment = getEnvironment();
	message.version = '0.3.1';
	message.timestamp = Date.now();
	return message;
}

async function sendToPubsub(message, channelId) {
	try {

		const url = `https://api.twitch.tv/helix/extensions/pubsub?broadcaster_id=${channelId}`;
		const headers = {
			'Client-ID': process.env.EXTENSION_CLIENT_ID,
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

exports.app = functions.https.onRequest(app);