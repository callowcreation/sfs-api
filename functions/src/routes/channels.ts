import * as express from 'express';
import * as admin from 'firebase-admin';

const router = express.Router();

router.use((req, res, next) => {
    console.log(`channels/${req.url}`, '@', new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    next();
});

router.route('/')
    .get((req, res) => {
        migrateLegacy().then(() => {
            collection()
                .get()
                .then((snap: any) => snap.docs.map((x: any) => x.data().broadcaster_id))
                .then((records: string[]) => {
                    res.json(records);
                });
        }).catch(e => {
            res.status(500).send(`channel ids migration incomplete`);
        });
    });

export default router;

function collection() {
    return admin.firestore().collection('channels');
}

async function migrateLegacy() {

    const ref = admin.database().ref(`channel_id`);

    ref.once('value')
        .then(snapshot => {
            snapshot.forEach(snap => {
                collection().add({ broadcaster_id: snap.val() })
                    .then(() => {
                        if (snap.key) {
                            return ref.child(snap.key).remove();
                        }
                        return null;
                    });
            });
        });
}