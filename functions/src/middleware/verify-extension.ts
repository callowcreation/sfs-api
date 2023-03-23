import { NextFunction, Request, Response } from "express";
// import * as jsonwebtoken from 'jsonwebtoken';
// import { CREDENTIALS } from "../constants/environment";

export function verifyExtension(req: Request, res: Response, next: NextFunction) {
    next();
    /*const authorization = req.headers.authorization;
    const bearerPrefix = 'Bearer ';
    if (authorization && authorization.startsWith(bearerPrefix)) {
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
    }*/
}
