export interface WelcomeData {
    stations: string[];
    signals: string[];
    tasks: string[];
    openclawTasks?: string[];
    inbox: number;
    agents: {
        name: string;
        state: string;
    }[];
}
export interface Asset {
    id: string;
    name?: string;
    position: {
        x: number;
        y: number;
    } | null;
    station?: string;
    content?: {
        type: string;
        data: string;
        source?: string;
        publishedAt?: string;
    };
    signal?: {
        type: string;
        interval?: number;
        payload?: unknown;
        allow_payload?: boolean;
    };
    task?: {
        type: string;
        public: boolean;
        openclaw: boolean;
        instructions?: string;
        assigned_to?: string;
        completion_target?: string;
    };
    prompt?: {
        template?: string;
        vars?: Record<string, string>;
    };
    display?: {
        text?: string;
        color?: string;
        bob?: boolean;
        ox?: number;
        oy?: number;
    };
    queue?: {
        max_trail?: number;
        forward_to?: string;
    };
    remote?: {
        url: string;
        station?: string;
    };
    archive?: boolean;
    welcome?: boolean;
    sign?: boolean;
    knowledge?: boolean;
}
export declare function hubHeaders(): Record<string, string>;
export declare function reportToHub(state: string, detail: string, agentId?: string, nameOverride?: string, parentAgentId?: string | null, spriteOverride?: string, note?: string): Promise<WelcomeData | null>;
export declare function formatWelcome(w: WelcomeData): string;
export declare function fetchPropertyFromHub(): Promise<{
    assets: Asset[];
    [key: string]: unknown;
}>;
