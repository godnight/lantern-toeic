/** Public, individually reviewed English-original discovery metadata. */
export type DiscoveryContentKind = 'video' | 'podcast' | 'article';
export type DiscoverySourceMode = 'live' | 'cached' | 'offline' | 'curated';
export type DiscoveryItem = Readonly<{
  id: string;
  kind: DiscoveryContentKind;
  title: string;
  author: string | null;
  publisher: string;
  platform: string;
  sourceId: string;
  sourceUrl: string;
  tags: readonly string[];
  durationLabel: string | null;
  language: 'en';
  originalLanguage: 'en';
  cover: Readonly<{ src: string; alt: string; credit: string; evidenceUrl: string }> | null;
  verification: Readonly<{ checkedAt: string; basis: string; evidenceUrls: readonly string[] }>;
}>;
export type DiscoverySourceStatus = Readonly<{ id: string; label: string; mode: DiscoverySourceMode }>;
export type DiscoveryFeedSnapshot = Readonly<{
  entries: readonly DiscoveryItem[];
  sources: readonly DiscoverySourceStatus[];
  status: 'seed' | 'fresh' | 'cached' | 'offline';
  refreshedAt: number | null;
}>;
export type DiscoveryFeedOptions = Readonly<{
  signal?: AbortSignal;
  canCommit?: () => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  fetchImpl?: typeof fetch;
}>;
