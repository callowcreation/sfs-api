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
    res.send('✧ ComStar ✧');
});
router.route('/:id')
    .get((req, res) => {
    console.log(req.headers);
    getChannelSettings(req.params.id)
        .then(settings => {
        res.json(settings);
    });
});
exports.default = router;
function getChannelSettingsRef(broadcaster_id) {
    return admin.database().ref(`${broadcaster_id}/settings`);
}
function getChannelSettings(broadcaster_id) {
    return getChannelSettingsRef(broadcaster_id)
        .once('value')
        .then(snap => snap.val());
}
//# sourceMappingURL=settings.js.map