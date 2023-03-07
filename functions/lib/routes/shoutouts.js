"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const admin = require("firebase-admin");
const extensions_pubsub_1 = require("../helpers/extensions-pubsub");
const timestamp_1 = require("../helpers/timestamp");
const router = express.Router();
const MAX_CHANNEL_SHOUTOUTS = 4;
const COLLECTIONS = {
    STATS: 'stats',
    SHOUTOUTS: 'shoutouts',
    PINS: 'pins'
};
router.use((req, res, next) => {
    console.log(`shoutouts ${req.url}`, '@', (0, timestamp_1.default)());
    next();
});
router.route('/')
    .get((req, res) => {
    migrateLegacy('75987197').then(() => {
        res.send('✧ ComStar ✧');
    }).catch(e => {
        res.status(500).send(`${75987197} migration incomplete`);
    });
});
router.route('/:id')
    .get((req, res) => {
    const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
    doc.get().then(value => {
        var _a, _b;
        if (!value.exists || ((_a = value.data()) === null || _a === void 0 ? void 0 : _a.sources.length) === 0) {
            admin.firestore().collection(COLLECTIONS.STATS)
                .where('broadcaster_id', '==', req.params.id)
                .orderBy('timestamp', 'desc')
                .limit(4)
                .get()
                .then((snap) => snap.docs.map((x) => ({ key: x.id, data: x.data() })))
                .then((records) => {
                const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
                doc.set({ sources: records.map((x) => x.key) });
                res.json(records.map((x) => (Object.assign({ key: x.key }, x.data))));
            });
        }
        else {
            const sources = (_b = value.data()) === null || _b === void 0 ? void 0 : _b.sources;
            const promises = [];
            for (let i = 0; i < sources.length; i++) {
                promises.push(admin.firestore().collection(COLLECTIONS.STATS).doc(sources[i]).get().then(x => (Object.assign({ key: x.id }, x.data()))));
            }
            Promise.all(promises).then(records => {
                console.log({ records });
                res.json(records);
            });
        }
    });
})
    .put((req, res) => {
    const guest = {
        legacy: false,
        broadcaster_id: req.params.id,
        streamer_id: req.body.streamer_id,
        poster_id: req.body.poster_id,
        timestamp: (0, timestamp_1.default)().getTime()
    };
    admin.firestore().collection(COLLECTIONS.STATS).add(guest).then(snap => {
        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
        doc.get().then(value => {
            if (value.exists) {
                const item = value.data() || [snap.id];
                item.sources.unshift(snap.id);
                item.sources.splice(MAX_CHANNEL_SHOUTOUTS);
                return doc.update(item);
            }
            return doc.set({ sources: [snap.id] });
        }).then(async () => {
            await (0, extensions_pubsub_1.broadcast)({ guest, action: 'shoutout' }, req.params.id);
            return res.end();
        });
    });
});
router.route('/:id/move-up')
    .put((req, res) => {
    const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
    doc.get().then(value => {
        if (value.exists) {
            const item = value.data() || { sources: [] };
            console.log({ sources: item.sources });
            const index = item.sources.findIndex((x) => x === req.body.key);
            const tmp = item.sources[index - 1];
            item.sources[index - 1] = item.sources[index];
            item.sources[index] = tmp;
            return doc.update(item).then(() => ({ index, action: 'move-up' }));
        }
        return null;
    }).then(async (payload) => {
        if (!payload)
            return res.status(404).end();
        await (0, extensions_pubsub_1.broadcast)(payload, req.params.id);
        return res.json(payload);
    });
});
router.route('/:id/pin-item')
    .get((req, res) => {
    getPinItem(req.params.id)
        .then(async (value) => {
        const values = value.map(x => ({ key: x.data.key, pinner_id: x.data.pinner_id }));
        const promises = [];
        for (let i = 0; i < values.length; i++) {
            promises.push(admin.firestore().collection(COLLECTIONS.STATS).doc(values[i].key).get().then(x => (Object.assign(Object.assign({ key: x.id }, x.data()), { pinner_id: values[i].pinner_id }))));
        }
        const records = await Promise.all(promises);
        return res.json(records);
    });
})
    .put((req, res) => {
    const enDate = (0, timestamp_1.default)().getTime() + (1000 * 10);
    const expireAt = new Date(enDate);
    admin.firestore().collection(COLLECTIONS.PINS)
        .add({ broadcaster_id: req.params.id, pinner_id: req.body.pinner_id, key: req.body.key, expireAt })
        .then(async () => {
        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
        const value = await doc.get();
        if (!value.exists)
            return null;
        const item = value.data() || { sources: [] };
        const index = item.sources.findIndex((x) => x === req.body.key);
        item.sources.splice(index, 1);
        return doc.update(item).then(() => ({ index, action: 'pin-item', expireAt }));
    }).then(async (payload) => {
        if (!payload)
            return res.status(404).end();
        await (0, extensions_pubsub_1.broadcast)(payload, req.params.id);
        return res.json(payload);
    });
});
exports.default = router;
async function getPinItem(broadcaster_id) {
    return admin.firestore().collection(COLLECTIONS.PINS)
        .where('broadcaster_id', '==', broadcaster_id)
        .limit(1)
        .get()
        .then(snap => snap.docs.map((x) => ({ key: x.id, data: x.data() })));
}
async function migrateLegacy(broadcaster_id) {
    const statRef = admin.database().ref(`${broadcaster_id}/stats`);
    const statCol = admin.firestore().collection(COLLECTIONS.STATS);
    const stats = await statRef.once('value').then(snap => snap.val());
    if (!stats)
        return;
    try {
        for (const streamer in stats) {
            for (const poster in stats[streamer]) {
                for (const key in stats[streamer][poster]) {
                    const timestamp = stats[streamer][poster][key];
                    const stat = { legacy: true, broadcaster_id, streamer_id: streamer, poster_id: poster, timestamp };
                    await statCol.add(stat);
                    await statRef.child(`${streamer}/${poster}/${key}`).remove();
                }
            }
        }
    }
    catch (e) {
        console.error(`Cound not create entry for ${broadcaster_id}`, e);
        throw e;
    }
}
//# sourceMappingURL=shoutouts.js.map