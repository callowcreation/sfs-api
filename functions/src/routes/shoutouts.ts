import * as express from 'express';

import * as admin from 'firebase-admin';
import { broadcast } from '../helpers/extensions-pubsub';
import timestamp from '../helpers/timestamp';
import { Guest } from '../interfaces/guest';
import PinItem, { Pinner } from '../interfaces/pin-item';

const router = express.Router();

const MAX_CHANNEL_SHOUTOUTS: number = 4;

const COLLECTIONS = {
    STATS: 'stats',
    SHOUTOUTS: 'shoutouts',
    PINS: 'pins'
};

router.use((req, res, next) => {
    console.log(`shoutouts ${req.url}`, '@', timestamp());
    next();
});

router.route('/')
    .get((req, res) => {
        migrateLegacy('75987197').then(() => {
            res.send('✧ ComStar ✧');
        }).catch(e => {
            res.status(500).send(`${75987197} migration incomplete`)
        });
    });

router.route('/:id')
    .get((req, res) => {
        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
        doc.get().then(value => {
            if (!value.exists || value.data()?.sources.length === 0) {
                admin.firestore().collection(COLLECTIONS.STATS)
                    .where('broadcaster_id', '==', req.params.id)
                    .orderBy('timestamp', 'desc')
                    .limit(4)
                    .get()
                    .then((snap: any) => snap.docs.map((x: any) => ({ key: x.id, data: x.data() })))
                    .then((records: any) => {
                        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
                        doc.set({ sources: records.map((x: any) => x.key) });
                        res.json(records.map((x: any) => ({ key: x.key, ...x.data })));
                    }).catch(err => res.status(500).send(err));;
            } else {
                const sources: string[] = value.data()?.sources;
                const promises: Promise<any>[] = [];
                for (let i = 0; i < sources.length; i++) {
                    promises.push(admin.firestore().collection(COLLECTIONS.STATS).doc(sources[i]).get().then(x => ({ key: x.id, ...x.data() })));
                }
                Promise.all(promises).then(records => {
                    console.log({ records })
                    res.json(records);
                }).catch(err => res.status(500).send(err));
            }
        });
    })
    .put((req, res) => {
        const guest = {
            legacy: false,
            broadcaster_id: req.params.id,
            streamer_id: req.body.streamer_id,
            poster_id: req.body.poster_id,
            timestamp: timestamp().getTime()
        };

        admin.firestore().collection(COLLECTIONS.STATS).add(guest).then(snap => {
            const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
            doc.get().then(value => {
                if (value.exists) {
                    return shoutoutsToGuests(req.params.id)
                        .then(records => {
                            const item = value.data() || [snap.id];
                            console.log({ records });
                            const index = records.findIndex(x => x.streamer_id === guest.streamer_id)
                            if (index !== -1) {
                                item.sources.splice(index, 1);
                            }

                            item.sources.unshift(snap.id);
                            item.sources.splice(MAX_CHANNEL_SHOUTOUTS);
                            return doc.update(item);
                        });
                }
                return doc.set({ sources: [snap.id] });
            }).then(async () => {
                await broadcast({ guest, action: 'shoutout', max_channel_shoutouts: MAX_CHANNEL_SHOUTOUTS }, req.params.id);
                return res.json({ source: snap.id });
            }).catch(err => res.status(500).send(err));
        })
    });

router.route('/:id/move-up')
    .put((req, res) => {
        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
        doc.get().then(value => {
            if (value.exists) {
                const item = value.data() || { sources: [] };
                console.log({ sources: item.sources })
                const index = item.sources.findIndex((x: any) => x === req.body.key);

                const tmp = item.sources[index - 1];
                item.sources[index - 1] = item.sources[index];
                item.sources[index] = tmp;
                return doc.update(item).then(() => ({ index, action: 'move-up' }));
            }
            return null;
        }).then(async (payload) => {
            if (!payload) return res.status(404).end();
            await broadcast(payload, req.params.id);
            return res.json(payload);
        }).catch(err => res.status(500).send(err));
    });

router.route('/:id/pin-item')
    .get((req, res) => {
        getPinItem(req.params.id)
            .then(async (value: PinItem[]) => {
                const values: Pinner[] = value.map(x => ({ key: x.data.key, pinner_id: x.data.pinner_id, expireAt: x.data.expireAt }));
                const promises: Promise<any>[] = [];
                for (let i = 0; i < values.length; i++) {
                    promises.push(admin.firestore().collection(COLLECTIONS.STATS).doc(values[i].key).get().then(x => ({ key: x.id, ...x.data(), pinner_id: values[i].pinner_id, expireAt: values[i].expireAt })));
                }
                const records = await Promise.all(promises);
                return res.json(records);
            }).catch(err => res.status(500).send(err));
    })
    .put((req, res) => {
        const enDate = timestamp().getTime() + (1000 * 10);
        const expireAt: number = enDate;

        admin.firestore().collection(COLLECTIONS.PINS)
            .add({ broadcaster_id: req.params.id, pinner_id: req.body.pinner_id, key: req.body.key, expireAt })
            .then(async () => {
                const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id)
                const value = await doc.get();
                if (!value.exists) return null;

                const item = value.data() || { sources: [] };
                const index = item.sources.findIndex((x: any) => x === req.body.key);
                item.sources.splice(index, 1);
                return doc.update(item).then(() => ({ index, action: 'pin-item', expireAt }));
            }).then(async (payload) => {
                if (!payload) return res.status(404).end();
                await broadcast(payload, req.params.id);
                return res.json(payload);
            }).catch(err => res.status(500).send(err));
    });

export default router;

async function shoutoutsToGuests(broadcaster_id: string): Promise<Guest[]> {
    const value = await admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(broadcaster_id).get();
    const sources: string[] = value.data()?.sources;
    const promises: Promise<Guest>[] = [];
    const statsCol = admin.firestore().collection(COLLECTIONS.STATS);
    for (let i = 0; i < sources.length; i++) {
        promises.push(statsCol.doc(sources[i]).get().then(x => ({ key: x.id, ...x.data() }) as Guest));
    }
    return Promise.all(promises);
}

async function getPinItem(broadcaster_id: string) {
    return admin.firestore().collection(COLLECTIONS.PINS)
        .where('broadcaster_id', '==', broadcaster_id)
        .limit(1)
        .get()
        .then(snap => snap.docs.map((x: any) => ({ key: x.id, data: x.data() })))
        .catch(err => { throw err; });
}

async function migrateLegacy(broadcaster_id: string) {

    const statRef = admin.database().ref(`${broadcaster_id}/stats`);
    const statCol = admin.firestore().collection(COLLECTIONS.STATS);

    const stats = await statRef.once('value').then(snap => snap.val());
    if (!stats) return;

    try {
        for (const streamer in stats) {
            for (const poster in stats[streamer]) {
                for (const key in stats[streamer][poster]) {
                    const timestamp = stats[streamer][poster][key];
                    const stat = { legacy: true, broadcaster_id, streamer_id: streamer, poster_id: poster, timestamp };
                    await statCol.add(stat);
                    //await statRef.child(`${streamer}/${poster}/${key}`).remove();
                }
            }
        }
    } catch (e) {
        console.error(`Cound not create entry for ${broadcaster_id}`, e);
        throw e;
    }
}