import * as functions from "firebase-functions";
import * as admin from 'firebase-admin';
import * as express from 'express';
import { Request, Response, Application } from 'express';
import * as cors from 'cors';

import channels from './routes/channels';
import settings from './routes/settings';
import shoutouts, { MAX_CHANNEL_SHOUTOUTS } from './routes/shoutouts';
import { broadcast } from "./helpers/extensions-pubsub";

admin.initializeApp({
    credential: admin.credential.cert('./serviceAccountKeyDev.json'),
    databaseURL: 'https://shoutoutsdev-38a1d.firebaseio.com'
});

const app: Application = express();

app.use(cors({ origin: true }));


app.use('/channels', channels);
app.use('/settings', settings);
app.use('/shoutouts', shoutouts);

app.get('/', async (req: Request, res: Response) => {
    res.send('Welcome to Terra');
});

async function deleteExpiredPins() {
    console.log(`running deleteExpiredPins...`)
    return admin.firestore().collection('pins')
        .where('expire_at', '<=', Date.now())
        .get()
        .then(snap => {

            if (snap.docs.length > 0) console.log(`snap.docs.length=${snap.docs.length}`)

            const promises: Promise<any>[] = [];
            for (let i = 0; i < snap.docs.length; i++) {
                const data = snap.docs[i].data();
                const doc = admin.firestore().collection('shoutouts').doc(data.broadcaster_id);
                const promise = doc.get().then(async value => {
                    console.log({ expire_index: i, key: data.key })

                    if (value.exists) {
                        const item = value.data() || { sources: [] };
                        item.sources.unshift(data.key);
                        item.sources.splice(MAX_CHANNEL_SHOUTOUTS);
                        return await doc.update(item);
                    }
                    return doc.set({ sources: [data.key] });
                }).then(() => snap.docs[i].ref.delete());
                promises.push(promise);
            }
            return Promise.all(promises)
        })
        .catch(err => {
            {
                console.error(err)
                throw err;
            }
        });
}

// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//
exports.app = functions.https.onRequest(app);

export const monitorPinnedTTL = functions.pubsub.schedule('*/1 * * * *').onRun(context => {
    console.log('sent delete')
    return deleteExpiredPins();
});

export const pinsUpdate = functions.firestore.document('pins/{id}').onDelete((change) => {
    const data = change.data();
    console.log({ ...data, id: change.id });

    const payload = { key: data.key, action: 'pin-item-remove' };
    return broadcast(payload, data.broadcaster_id);
});

/*export const shoutoutsUpdate = functions.firestore.document('shoutouts/{id}').onUpdate((change, context) => {
    const after = change.after.data();
    console.log({ after, context });
    const broadcaster_id: string = context.params.id;

    const sources: string[] = after.sources;
    const promises: Promise<any>[] = [];
    for (let i = 0; i < sources.length; i++) {
        promises.push(admin.firestore().collection('stats').doc(sources[i]).get().then(x => ({ key: x.id, ...x.data() })));
    }
    return Promise.all(promises).then(payload => {
        console.log({ payload })
        return broadcast({ guests: payload }, broadcaster_id);
    });
});*/