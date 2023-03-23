import { Router, Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { DataSnapshot, Reference } from 'firebase-admin/database';
import { CollectionReference, DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';

const router = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`channels ${req.url}`, '@', Date.now());
    next();
});

router.route('/')
    .get((req: Request, res: Response) => {
        migrateLegacy().then(() => {
            collection().doc('ids')
                .get()
                .then((snap: DocumentSnapshot<DocumentData>) => snap.data()?.items)
                .then((records: string[]) => {
                    res.json(records);
                }).catch(err => res.status(500).send(err));
        }).catch(e => {
            res.status(500).send(`channel ids migration incomplete: ${e.message}`);
        });
    });

export default router;

function collection(): CollectionReference<DocumentData> {
    return admin.firestore().collection('channels');
}

async function migrateLegacy(): Promise<void> {
    const ref: Reference = admin.database().ref(`channel_id`);

    return ref.once('value').then((snapshot: DataSnapshot) => {
        const items: string[] = [];
        snapshot.forEach((snap: DataSnapshot) => {
            items.push(snap.val());
        });
        return collection().doc('ids').set({ items })
            .then(() => ref.remove());
    });
}