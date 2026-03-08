export interface AssetLike {
    id: string;
    name?: string;
}
/** Find an asset by exact ID first, then case-insensitive partial name match. */
export declare function findAsset<T extends AssetLike>(assets: T[], query: string): T | undefined;
