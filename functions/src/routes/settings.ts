import * as express from 'express';
import * as admin from 'firebase-admin';

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
        getChannelSettings(req.params.id)
            .then(settings => {
                res.json(settings);
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