import * as express from 'express';
import * as admin from 'firebase-admin';

const router = express.Router();

router.use(function (req, res, next) {
    console.log(`settings/${req.url}`, '@', new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
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
                if (!settings.commands) settings.commands = [];
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

export default router;

function getChannelSettingsRef(broadcaster_id: string) {
    return admin.database().ref(`${broadcaster_id}/settings`);
}

function getChannelSettings(broadcaster_id: string) {
    return getChannelSettingsRef(broadcaster_id)
        .once('value')
        .then(snap => snap.val());
}