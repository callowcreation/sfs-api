import * as functions from "firebase-functions";
import * as admin from 'firebase-admin';
import * as express from 'express';
import { Request, Response, Application } from 'express';
import * as cors from 'cors';

import channels from './routes/channels';
import settings from './routes/settings';
import shoutouts from './routes/shoutouts';

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


// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//
exports.app = functions.https.onRequest(app);
