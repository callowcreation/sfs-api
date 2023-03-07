
export interface PinData {
    broadcaster_id: string,
    pinner_id: string,
    expireAt: Date,
    key: string
}

export default interface PinItem {
    key: string,
    data: PinData
}

export interface Pinner {
    key: string;
    pinner_id: string
}