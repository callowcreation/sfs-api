import * as express from 'express';
import * as admin from 'firebase-admin';

const router = express.Router();

router.use((req, res, next) => {
    console.log(`settings ${req.url}`, '@', Date.now());
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
            }).catch(err => res.status(500).send(err));
    })
    .put((req, res) => {
        updateChannelSettings(req.params.id, req.body.values)
            .then(() => res.json(req.body.values))
            .catch(err => res.status(500).send(err));
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
            }).catch(err => res.status(500).send(err));
    });

export default router;

function getChannelSettingsRef(broadcaster_id: string) {
    return admin.database().ref(`${broadcaster_id}/settings`);
}

function getChannelSettings(broadcaster_id: string) {
    return getChannelSettingsRef(broadcaster_id)
        .once('value')
        .then(snap => snap.val())
        .catch(err => { throw err });
}

function updateChannelSettings(broadcaster_id: string, values: any) {
    return getChannelSettingsRef(broadcaster_id).update(values);
}