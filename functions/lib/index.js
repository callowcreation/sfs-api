"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const channels_1 = require("./routes/channels");
const settings_1 = require("./routes/settings");
const shoutouts_1 = require("./routes/shoutouts");
// import { broadcast } from "./helpers/extensions-pubsub";
admin.initializeApp({
    credential: admin.credential.cert('./serviceAccountKeyDev.json'),
    databaseURL: 'https://shoutoutsdev-38a1d.firebaseio.com'
});
const app = express();
app.use(cors({ origin: true }));
app.use('/channels', channels_1.default);
app.use('/settings', settings_1.default);
app.use('/shoutouts', shoutouts_1.default);
app.get('/', async (req, res) => {
    res.send('Welcome to Terra');
});
// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//
exports.app = functions.https.onRequest(app);
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
//# sourceMappingURL=index.js.map