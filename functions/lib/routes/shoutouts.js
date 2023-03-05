"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const admin = require("firebase-admin");
const extensions_pubsub_1 = require("../helpers/extensions-pubsub");
const router = express.Router();
const MAX_CHANNEL_SHOUTOUTS = 4;
router.use(function (req, res, next) {
    console.log(`shoutouts/${req.url}`, '@', new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
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
    const doc = admin.firestore().collection('shoutouts').doc(req.params.id);
    doc.get().then(value => {
        var _a, _b;
        if (!value.exists || ((_a = value.data()) === null || _a === void 0 ? void 0 : _a.sources.length) === 0) {
            collection()
                .where('broadcaster_id', '==', req.params.id)
                .orderBy('timestamp', 'desc')
                .limit(4)
                .get()
                .then((snap) => snap.docs.map((x) => ({ key: x.id, data: x.data() })))
                .then((records) => {
                const doc = admin.firestore().collection('shoutouts').doc(req.params.id);
                doc.set({ sources: records.map((x) => x.key) });
                res.json(records.map((x) => x.data));
            });
        }
        else {
            const sources = (_b = value.data()) === null || _b === void 0 ? void 0 : _b.sources;
            const promises = [];
            for (let i = 0; i < sources.length; i++) {
                promises.push(collection().doc(sources[i]).get().then(x => x.data()));
            }
            Promise.all(promises).then(records => res.json(records));
        }
    });
})
    .put((req, res) => {
    const guest = {
        legacy: false,
        broadcaster_id: req.params.id,
        streamer_id: req.body.streamer_id,
        poster_id: req.body.poster_id,
        timestamp: Date.now()
    };
    collection().add(guest).then(snap => {
        const doc = admin.firestore().collection('shoutouts').doc(req.params.id);
        doc.get().then(value => {
            if (value.exists) {
                const item = value.data() || [snap.id];
                item.sources.unshift(snap.id);
                item.sources.splice(MAX_CHANNEL_SHOUTOUTS);
                return doc.update(item);
            }
            return doc.set({ sources: [snap.id] });
        });
        console.log(snap.id);
        return (0, extensions_pubsub_1.send)({ snap_id: snap.id }, req.params.id)
            .then(json => {
            console.log({ json });
            res.json(snap.id);
        });
    });
});
exports.default = router;
function collection() {
    return admin.firestore().collection('stats');
}
async function migrateLegacy(broadcaster_id) {
    const statRef = admin.database().ref(`${broadcaster_id}/stats`);
    const stats = await statRef.once('value').then(snap => snap.val());
    if (!stats)
        return;
    try {
        for (const streamer in stats) {
            for (const poster in stats[streamer]) {
                for (const key in stats[streamer][poster]) {
                    const timestamp = stats[streamer][poster][key];
                    const stat = { legacy: true, broadcaster_id, streamer_id: streamer, poster_id: poster, timestamp };
                    await collection().add(stat);
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