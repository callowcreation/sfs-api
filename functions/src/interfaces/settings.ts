export type Tier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export interface Appearance {
    'background-color': string;
    'border-color': string;
    'color': string;
}

export interface Behaviour {
    'auto-shoutouts': boolean;
    'badge-vip': boolean;
    'commands': string[];
}

export interface Bits {
    'enable-bits': boolean;
    'bits-tier': Tier;
    'pin-days': number;
}

export interface Settings extends Bits, Behaviour, Appearance { }
