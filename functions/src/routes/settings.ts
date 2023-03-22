import * as express from 'express';
import * as admin from 'firebase-admin';

const router = express.Router();

const defaultSettings: any = {
    'background-color': '#6441A5',
    'border-color': '#808080',
    'color': '#FFFFFF',
    'auto-shoutouts': false,
    'enable-bits': true,
    'bits-tier': 'Tier 1',
    'pin-days': 3,
    'badge-vip': true,
    'commands': ['so', 'shoutout'],
};

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
            .then((settings: any) => {

                if (!settings) settings = {};

                Object.keys(defaultSettings).forEach((key: string) => {
                    if (!Object.keys(settings).includes(key)) {
                        settings[key] = defaultSettings[key];
                    }
                });

                res.json(settings);
            }).catch(err => res.status(500).send(err));
    })
    .put((req, res) => {

        getChannelSettings(req.params.id)
            .then((settings: any) => {

                if (!settings) settings = {};

                Object.keys(defaultSettings).forEach((key: string) => {
                    if (!Object.keys(settings).includes(key)) {
                        settings[key] = defaultSettings[key];
                    }
                });

                Object.keys(req.body.values).forEach((key: string) => {
                    settings[key] = req.body.values[key];
                });

                return updateChannelSettings(req.params.id, settings)
                    .then(() => res.json(settings))
                    .catch(err => res.status(500).send(err));

            }).catch(err => res.status(500).send(err));


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