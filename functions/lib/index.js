"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const settings_1 = require("./routes/settings");
const shoutouts_1 = require("./routes/shoutouts");
admin.initializeApp({
    credential: admin.credential.cert('./serviceAccountKeyDev.json'),
    databaseURL: 'https://shoutoutsdev-38a1d.firebaseio.com'
});
const app = express();
app.use(cors({ origin: true }));
app.use('/settings', settings_1.default);
app.use('/shoutouts', shoutouts_1.default);
app.get('/', async (req, res) => {
    res.send('Welcome to Terra');
});
// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//
exports.app = functions.https.onRequest(app);
//# sourceMappingURL=index.js.map