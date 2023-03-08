import { Guest } from "./guest";

export interface Patron extends Guest {
    pinner_id: string;
    expireAt: number;
}