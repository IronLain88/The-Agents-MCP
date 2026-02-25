export interface AssetLike {
  id: string;
  name?: string;
}

/** Find an asset by exact ID first, then case-insensitive partial name match. */
export function findAsset<T extends AssetLike>(assets: T[], query: string): T | undefined {
  // Exact ID match takes priority
  const byId = assets.find(a => a.id === query);
  if (byId) return byId;

  // Fuzzy name match (case-insensitive, partial)
  const lower = query.toLowerCase();
  return assets.find(a => (a.name || a.id).toLowerCase().includes(lower));
}
