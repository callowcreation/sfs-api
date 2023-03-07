"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const admin = require("firebase-admin");
const timestamp_1 = require("../helpers/timestamp");
const router = express.Router();
router.use((req, res, next) => {
    console.log(`settings ${req.url}`, '@', (0, timestamp_1.default)());
    next();
});
router.route('/')
    .get((req, res) => {
    res.send('✧ ComStar ✧');
});
router.route('/:id')
    .get((req, res) => {
    getChannelSettings(req.params.id)
        .then(settings => {
        res.json(settings);
    });
});
router.route('/:id/behaviours')
    .get((req, res) => {
    getChannelSettings(req.params.id)
        .then(settings => {
        if (!settings.commands)
            settings.commands = [];
        if (settings.commands.length === 0) {
            settings.commands.push(...['so', 'shoutout']);
        }
        res.json({
            'auto-shoutouts': settings['auto-shoutouts'],
            'badge-vip': settings['badge-vip'],
            'commands': settings.commands
        });
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