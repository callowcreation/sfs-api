"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();
router.use(function (req, res, next) {
    console.log(req.url, '@', Date.now());
    next();
});
router.route('/')
    .get((req, res) => {
    migrateLegacyStats('75987197').then(() => {
        res.send('✧ ComStar ✧');
    }).catch(e => {
        res.status(500).send(`${75987197} migration incomplete`);
    });
});
router.route('/:id')
    .get((req, res) => {
    admin.firestore().collection('stats')
        .where('broadcaster_id', '==', req.params.id)
        .orderBy('timestamp', 'desc')
        .limit(4)
        .get()
        .then((snap) => snap.docs.map((x) => x.data()))
        .then((records) => {
        res.json(records);
    });
});
exports.default = router;
async function migrateLegacyStats(broadcaster_id) {
    const statRef = admin.database().ref(`${broadcaster_id}/stats`);
    const stats = await statRef
        .once('value')
        .then(snap => snap.val());
    if (!stats)
        return;
    const statsCollection = admin.firestore().collection('stats');
    try {
        for (const streamer in stats) {
            for (const poster in stats[streamer]) {
                for (const key in stats[streamer][poster]) {
                    const timestamp = stats[streamer][poster][key];
                    const stat = { legacy: true, broadcaster_id, streamer_id: streamer, poster_id: poster, timestamp };
                    await statsCollection.add(stat);
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