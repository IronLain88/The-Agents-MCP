export interface WelcomeData {
    stations: string[];
    signals: string[];
    boards: string[];
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
    trigger?: string;
    trigger_interval?: number;
    task?: boolean;
    openclaw_task?: boolean;
}
export declare function hubHeaders(): Record<string, string>;
export declare function reportToHub(state: string, detail: string, agentId?: string, nameOverride?: string, parentAgentId?: string | null, spriteOverride?: string, note?: string): Promise<WelcomeData | null>;
export declare function formatWelcome(w: WelcomeData): string;
export declare function fetchPropertyFromHub(): Promise<{
    assets: Asset[];
    [key: string]: unknown;
}>;
