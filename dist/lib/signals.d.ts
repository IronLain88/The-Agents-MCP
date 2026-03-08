export declare function getSubscribedStations(): string[];
export declare function setSubscribedStations(stations: string[]): void;
export declare function isWsOpen(): boolean;
export declare function connectSignalWs(): void;
export declare function waitForSignal(): Promise<string>;
export declare function tryClaimPendingTask(station: string): Promise<string | null>;
