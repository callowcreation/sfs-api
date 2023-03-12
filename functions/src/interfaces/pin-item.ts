
export interface PinData {
    broadcaster_id: string,
    pinner_id: string,
    expire_at: number,
    key: string
}

export default interface PinItem {
    key: string,
    data: PinData
}

export interface Pinner {
    key: string;
    pinner_id: string;
}