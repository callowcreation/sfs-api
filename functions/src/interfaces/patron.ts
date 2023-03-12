import { Guest } from "./guest";

export interface Patron extends Guest {
    pinner_id: string;
    expire_at: number;
}