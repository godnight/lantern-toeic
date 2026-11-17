/** Public, individually reviewed English-original discovery metadata. */
export type DiscoveryContentKind = 'video' | 'podcast' | 'article';
export type DiscoverySourceMode = 'live' | 'cached' | 'offline' | 'curated';
export type DiscoveryItem = Readonly<{
  id: string;
  kind: DiscoveryContentKind;
  title: string;
  /** Original publisher's publication timestamp, when provided and valid. */
  publishedAt?: string | null;
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
export type DiscoveryRefreshSummary = Readonly<{
  outcome: 'updated' | 'unchanged' | 'partial' | 'failed';
  added: number;
  attemptedAt: number;
}>;
export type DiscoveryFeedSnapshot = Readonly<{
  entries: readonly DiscoveryItem[];
  sources: readonly DiscoverySourceStatus[];
  status: 'seed' | 'fresh' | 'cached' | 'offline';
  refreshedAt: number | null;
  lastSuccessAt: number | null;
  refresh: DiscoveryRefreshSummary | null;
}>;
export type DiscoveryFeedOptions = Readonly<{
  signal?: AbortSignal;
  canCommit?: () => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  fetchImpl?: typeof fetch;
}>;
