import { Guest } from "./guest";

export interface ActionGuest extends Guest {
    pinner_id: string;
}