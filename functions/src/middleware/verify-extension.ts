import { NextFunction, Request, Response } from "express";
import * as jsonwebtoken from 'jsonwebtoken';
import { CREDENTIALS } from "../constants/environment";

export function verifyAuthorization(req: Request, res: Response, next: NextFunction) {
    const authorization = req.headers.authorization || '';
    const basicPrefix = 'Basic ';
    const bearerPrefix = 'Bearer ';
    if(authorization.startsWith(basicPrefix)) {
        try {
            const token = authorization.substring(basicPrefix.length);
            if(token !== Buffer.from(CREDENTIALS.EXTENSION_CLIENT_ID + ':' + CREDENTIALS.EXTENSION_SECRET).toString('base64')) {
                throw new Error('invalid_auth_header');
            }
            next();
        } catch (ex) {
            console.error('invalid_auth_header', ex);
            res.status(403).end();
        }
    } else if (authorization.startsWith(bearerPrefix)) {
        try {
            const token = authorization.substring(bearerPrefix.length);
            const extension_secret = Buffer.from(CREDENTIALS.EXTENSION_SECRET, 'base64');
            jsonwebtoken.verify(token, extension_secret, { algorithms: ['HS256'] });
            next();
        } catch (ex) {
            console.error('invalid_auth_header', ex);
            res.status(403).end();
        }
    } else {
        res.status(400).end();
    }
}