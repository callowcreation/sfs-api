import * as express from 'express';
import * as admin from 'firebase-admin';
import { broadcast } from '../helpers/extensions-pubsub';
import { Guest } from '../interfaces/guest';
import PinItem, { Pinner } from '../interfaces/pin-item';

const router = express.Router();

export const MAX_CHANNEL_SHOUTOUTS: number = 4;

const COLLECTIONS = {
    MIGRATION: 'migration',
    STATS: 'stats',
    SHOUTOUTS: 'shoutouts',
    PINS: 'pins'
};

router.use((req, res, next) => {
    console.log(`shoutouts ${req.url}`, '@', Date.now());
    next();
});

router.route('/')
    .get((req, res) => {
        migrateLegacy('75987197').then((data) => {
            res.json({msg: '✧ ComStar ✧', data});
        }).catch(e => {
            res.status(500).json({message: `${75987197} migration incomplete`, error: e})
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
                getGuests(value.data()?.sources).then(records => {
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
            timestamp: Date.now()
        };

        admin.firestore().collection(COLLECTIONS.STATS).add(guest).then(snap => {
            const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
            doc.get().then(async value => {
                if (value.exists) {
                    const records = await shoutoutsToGuests(req.params.id);
                    const item = value.data() || [snap.id];
                    const index = records.findIndex(x => x.streamer_id === guest.streamer_id);
                    if (index !== -1) {
                        item.sources.splice(index, 1);
                    }
                    item.sources.unshift(snap.id);
                    item.sources.splice(MAX_CHANNEL_SHOUTOUTS);
                    return await doc.update(item);
                }
                return doc.set({ sources: [snap.id] });
            }).then(async () => {
                await broadcast({ guest, action: 'shoutout', max_channel_shoutouts: MAX_CHANNEL_SHOUTOUTS }, req.params.id);
                return res.json({ source: snap.id });
            }).catch(err => res.status(500).send(err));
        })
    })
    .delete(async (req, res) => {
        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id);
        const value = await doc.get();
        if (!value.exists) return res.status(404).end();

        const item = value.data() || { sources: [] };
        const index = item.sources.findIndex((x: any) => x === req.query.key);
        item.sources.splice(index, 1);
        await doc.update(item);
        const payload = {
            action: 'item-remove',
            index: index
        };
        await broadcast(payload, req.params.id);
        return res.status(204).end();
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
                const values: Pinner[] = value.map(x => ({ key: x.data.key, pinner_id: x.data.pinner_id }));
                const promises: Promise<any>[] = [];
                for (let i = 0; i < values.length; i++) {
                    promises.push(admin.firestore().collection(COLLECTIONS.STATS).doc(values[i].key).get().then(x => ({ key: x.id, ...x.data(), pinner_id: values[i].pinner_id })));
                }
                const records = await Promise.all(promises);
                return res.json(records);
            }).catch(err => res.status(500).send(err));
    })
    .put((req, res) => {
        const enDate = Date.now() + (1000 * 10);
        const expire_at: number = enDate;

        admin.firestore().collection(COLLECTIONS.PINS)
            .add({ broadcaster_id: req.params.id, pinner_id: req.body.pinner_id, key: req.body.key, expire_at })
            .then(async () => {
                const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(req.params.id)
                const value = await doc.get();
                if (!value.exists) return null;

                const item = value.data() || { sources: [] };
                const index = item.sources.findIndex((x: any) => x === req.body.key);
                item.sources.splice(index, 1);
                return doc.update(item).then(() => ({ index, action: 'pin-item', pinner_id: req.body.pinner_id }));
            }).then(async (payload) => {
                if (!payload) return res.status(404).end();
                await broadcast(payload, req.params.id);
                return res.json(payload);
            }).catch(err => res.status(500).send(err));
    })
    .delete(async (req, res) => {
        await deletePin(req.params.id).then(payload => {
            if (!payload) res.status(404).end();
            return res.json(payload);
        }).catch(err => res.status(500).send(err.message));
    });

export default router;

async function deletePin(broadcaster_id: string): Promise<any> {
    try {
        const snap = await admin.firestore().collection(COLLECTIONS.PINS)
            .where('broadcaster_id', '==', broadcaster_id)
            .orderBy('expire_at', 'desc')
            .limit(1)
            .get();

        if (snap.empty) return null;

        const doc = admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(broadcaster_id);
        const value = await doc.get();

        const key = snap.docs[0].data().key;
        console.log({ key }, snap.docs[0].data().key);
        if (value.exists) {
            const item = value.data() || { sources: [] };
            item.sources.unshift(key);
            item.sources.splice(MAX_CHANNEL_SHOUTOUTS);
            await doc.update(item);
        } else {
            await doc.set({ sources: [key] });
        }
        await snap.docs[0].ref.delete();

        const payload = { key: snap.docs[0].id, action: 'pin-item-remove', max_channel_shoutouts: MAX_CHANNEL_SHOUTOUTS };

        console.log(snap.docs[0].data().pinner_id, payload);

        return broadcast(payload, broadcaster_id);
    } catch (err) {
        console.error(err);
    }
}

async function shoutoutsToGuests(broadcaster_id: string): Promise<Guest[]> {
    const value = await admin.firestore().collection(COLLECTIONS.SHOUTOUTS).doc(broadcaster_id).get();
    const sources: string[] = value.data()?.sources;
    return getGuests(sources);
}

function getGuests(sources: string[]): Promise<Guest[]> {
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

export async function migrateLegacy(broadcaster_id: string) {

    const statRef = admin.database().ref(`${broadcaster_id}/stats`);
    const stats = await statRef.once('value').then(snap => snap.val());
    if (!stats) return -1;
    
    let counter: number = 0;
    
    try {
        const statCol = admin.firestore().collection(COLLECTIONS.STATS);
        const migrationCol = admin.firestore().collection(COLLECTIONS.MIGRATION);
        const total: number = await migrationCol.doc(broadcaster_id).get().then(value => {
            return value.exists ? value.data()?.total || 0 : 0;
        });
        counter += total;
        await migrationCol.doc(broadcaster_id).set({ migrage: true, total: counter });
    
        for (const streamer in stats) {
            for (const poster in stats[streamer]) {
                for (const key in stats[streamer][poster]) {
                    const timestamp = stats[streamer][poster][key];
                    const stat = { legacy: true, broadcaster_id, streamer_id: streamer, poster_id: poster, timestamp };
                    await statCol.add(stat);
                    await statRef.child(`${streamer}/${poster}/${key}`).remove();
                    counter++;
                    if (counter === 250) {
                        await migrationCol.doc(broadcaster_id).update({ total: counter });
                        return counter;
                    }
                }
            }
        }
        
        await migrationCol.doc(broadcaster_id).update({ migrage: false, total: counter });
        console.log(`FULL Migration complete: ${broadcaster_id}`);
        return counter;
    } catch (e) {
        console.error(`counter ${counter} - Cound not create entry for ${broadcaster_id}`, e);
        throw new Error(JSON.stringify({message: `counter ${counter} - Cound not create entry for ${broadcaster_id}`, counter, error: e}));
    }
}