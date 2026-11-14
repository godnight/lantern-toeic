import catalog from '../content/discovery-native.json';
import { readRssItems } from './discovery-rss-stream.mjs';
import type { DiscoveryItem, DiscoveryFeedOptions, DiscoveryFeedSnapshot, DiscoverySourceMode } from './discovery-feed-contract';

type Candidate = { guid: string | null; link: string | null; title: string | null; publishedAt: string | null; language: string | null; description: string | null; descriptionTruncated: boolean };
type SourceCache = { fetchedAt: number; items: Candidate[] };
type Cache = { schemaVersion: 1; sources: Partial<Record<'nasa' | '99pi', SourceCache>> };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const CACHE_KEY = 'lantern-discovery-public-feed-v1';
const MAX_CACHE = 512 * 1024;
const SOURCES = [
  { id: 'nasa' as const, label: 'NASA', url: 'https://www.nasa.gov/feed/' },
  { id: '99pi' as const, label: '99% Invisible', url: 'https://feeds.simplecast.com/BqbsxVfO' },
];
const OTHER_SOURCES = [ {id:'stanford',label:'Stanford'}, {id:'blender',label:'Blender'}, {id:'guardian',label:'The Guardian'}, {id:'ted',label:'TED'} ];
const DEFAULT_CACHE: Cache = { schemaVersion: 1, sources: {} };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINAL_EPISODE = '7ad3e14f-f99c-4988-a755-44af989cfd74';
const reviewed = catalog.entries as DiscoveryItem[];
export const DISCOVERY_SEED: readonly DiscoveryItem[] = reviewed;

function storageFor(value?: StorageLike | null): StorageLike | null {
  if (value !== undefined) return value;
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function safeUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\x00-\x1f]/.test(value)) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null; } catch { return null; }
}
function nasaKey(value: unknown): string | null {
  const u = safeUrl(value); if (!u || u.hostname !== 'www.nasa.gov' || u.search || u.hash) return null;
  return u.origin + u.pathname.replace(/\/$/, '');
}
const reviewedNasa = new Map<string, DiscoveryItem>();
for (const item of DISCOVERY_SEED) { const key = item.sourceId === 'nasa' ? nasaKey(item.sourceUrl) : null; if (key) reviewedNasa.set(key, item); }
function reviewedNasaItem(url: unknown): DiscoveryItem | undefined { const key = nasaKey(url); return key ? reviewedNasa.get(key) : undefined; }
function podUrl(value: unknown): string | null {
  const u = safeUrl(value);
  if (!u || u.hostname !== '99percentinvisible.org' || u.hash) return null;
  if (/^\/episode\/[a-z0-9-]+\/?$/i.test(u.pathname) && !u.search) return u.href;
  if (u.pathname === '/' && /^\?p=\d{1,12}$/.test(u.search)) return u.href;
  return null;
}
function isCandidate(value: unknown): value is Candidate {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['guid','link','title','publishedAt','language','description'].every(k => v[k] === null || typeof v[k] === 'string' && (v[k] as string).length <= (k === 'description' ? 3000 : 4096)) && typeof v.descriptionTruncated === 'boolean';
}
function podcastItem(row: Candidate): DiscoveryItem | null {
  if (!row.guid || !UUID.test(row.guid) || !row.title || row.title.length > 500 || !podUrl(row.link) || row.descriptionTruncated) return null;
  if (row.language && !/^en(?:[-_][a-z0-9]+)*$/i.test(row.language)) return null;
  const text = (row.title + ' ' + (row.description || '')).normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g, '');
  if (/中文配音|中配|AI配音|机器翻译|译配|\btranslat(?:ed|ion)\b|\bdubb(?:ed|ing)\b|(?:audio|voice|narrat(?:ion|ed))\s+(?:in\s+)?(?:mandarin|chinese|spanish|french)\b|\ben español\b|\ben français\b/i.test(text)) return null;
  const guid = row.guid.toLowerCase();
  if (guid === ORIGINAL_EPISODE) return DISCOVERY_SEED.find(x => x.id === '99pi-white-house-solar-panels') || null;
  const url = podUrl(row.link)!;
  return { id:'99pi-' + guid, kind:'podcast', title:row.title, author:null, publisher:'99% Invisible', platform:'99% Invisible', sourceId:'99pi', sourceUrl:url, tags:['Design','Culture'], durationLabel:null, language:'en', originalLanguage:'en', cover:null,
    verification:{checkedAt:'2026-11-14', basis:'Publisher-declared English original program; this episode has not been individually auditioned. Source policy applies only to the official 99% Invisible feed.', evidenceUrls:['https://99percentinvisible.org/about/the-show/','https://feeds.simplecast.com/BqbsxVfO',url]} };
}
/** Rebuild display metadata from an owner-scoped saved public reference.
 * Stored verification, author, cover and publisher fields are never trusted. */
export function restoreSavedDiscoveryItem(value: unknown): DiscoveryItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.sourceUrl !== 'string' || !row.id.startsWith('99pi-')) return null;
  const item = podcastItem({guid:row.id.slice(5),title:row.title,link:row.sourceUrl,publishedAt:null,language:null,description:null,descriptionTruncated:false});
  return item && item.id === row.id ? item : null;
}
function readCache(storage: StorageLike | null): { cache: Cache; writable: boolean } {
  if (!storage) return {cache:DEFAULT_CACHE,writable:false};
  try {
    const raw = storage.getItem(CACHE_KEY); if (raw === null) return {cache:DEFAULT_CACHE,writable:true};
    if (raw.length > MAX_CACHE) return {cache:DEFAULT_CACHE,writable:false};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {cache:DEFAULT_CACHE,writable:false};
    const p = parsed as Record<string, unknown>;
    if (p.schemaVersion !== 1 || !p.sources || typeof p.sources !== 'object' || Array.isArray(p.sources)) return {cache:DEFAULT_CACHE,writable:false};
    const incoming = p.sources as Record<string, unknown>, sources: Cache['sources'] = {};
    if (Object.keys(incoming).some(k => k !== 'nasa' && k !== '99pi')) return {cache:DEFAULT_CACHE,writable:false};
    for (const id of ['nasa','99pi'] as const) {
      const value = incoming[id]; if (value === undefined) continue;
      if (!value || typeof value !== 'object') return {cache:DEFAULT_CACHE,writable:false};
      const v = value as Record<string, unknown>;
      if (typeof v.fetchedAt !== 'number' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.items) || v.items.length > 50 || !v.items.every(isCandidate)) return {cache:DEFAULT_CACHE,writable:false};
      sources[id] = { fetchedAt:v.fetchedAt, items:v.items as Candidate[] };
    }
    return {cache:{schemaVersion:1,sources},writable:true};
  } catch { return {cache:DEFAULT_CACHE,writable:false}; }
}
function snapshot(cache: Cache, mode: 'seed' | 'fresh' | 'cached' | 'offline', live = new Set<string>()): DiscoveryFeedSnapshot {
  const added: DiscoveryItem[] = [];
  for (const row of cache.sources.nasa?.items || []) { const item = reviewedNasaItem(row.link); if (item) added.push(item); }
  for (const row of cache.sources['99pi']?.items || []) { const item = podcastItem(row); if (item) added.push(item); }
  // The approved leading artwork stays first, followed by current source items.
  const entries: DiscoveryItem[] = [], ids = new Set<string>(), urls = new Set<string>();
  for (const item of [DISCOVERY_SEED[0],...added,...DISCOVERY_SEED.slice(1)]) {
    if (!item || ids.has(item.id) || urls.has(item.sourceUrl)) continue;
    ids.add(item.id); urls.add(item.sourceUrl); entries.push(item);
  }
  const sources = SOURCES.map(s => ({id:s.id,label:s.label,mode:(live.has(s.id) ? 'live' : cache.sources[s.id] ? 'cached' : mode === 'seed' ? 'curated' : 'offline') as DiscoverySourceMode}));
  const times = Object.values(cache.sources).map(s => s!.fetchedAt);
  return {entries,sources:[...sources,...OTHER_SOURCES.map(s => ({...s,mode:'curated' as const}))],status:mode,refreshedAt:times.length ? Math.max(...times) : null};
}
export function readDiscoveryFeedCache(storage?: StorageLike | null): DiscoveryFeedSnapshot {
  const {cache} = readCache(storageFor(storage));
  return snapshot(cache,Object.keys(cache.sources).length ? 'cached' : 'seed');
}
function mayCommit(options: DiscoveryFeedOptions): boolean {
  try { return !options.signal?.aborted && (!options.canCommit || options.canCommit()); } catch { return false; }
}
async function fetchSource(source: typeof SOURCES[number], fetcher: typeof fetch, outer?: AbortSignal): Promise<Candidate[]> {
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const cancellation = new Promise<never>((_,reject) => { rejectAbort = reject; });
  const cancel = () => { controller.abort(); rejectAbort(new Error('Feed request cancelled')); };
  if (outer?.aborted) cancel(); else outer?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(cancel,10000);
  try {
    const work = (async () => {
      const response = await fetcher(source.url,{signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/rss+xml, application/xml, text/xml'}});
      return await readRssItems(response,{signal:controller.signal});
    })();
    return await Promise.race([work,cancellation]);
  } finally { clearTimeout(timer); outer?.removeEventListener('abort',cancel); }
}
export async function refreshDiscoveryFeed(options: DiscoveryFeedOptions = {}): Promise<DiscoveryFeedSnapshot> {
  const storage = storageFor(options.storage), initial = readCache(storage);
  if (!mayCommit(options)) return snapshot(initial.cache,Object.keys(initial.cache.sources).length ? 'cached' : 'seed');
  const fetcher = options.fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
  if (!fetcher) return snapshot(initial.cache,Object.keys(initial.cache.sources).length ? 'cached' : 'offline');
  const startedAt = Date.now();
  const results = await Promise.allSettled(SOURCES.map(source => fetchSource(source,fetcher,options.signal)));
  if (!mayCommit(options)) return snapshot(initial.cache,Object.keys(initial.cache.sources).length ? 'cached' : 'seed');
  const latest = readCache(storage), next: Cache = {schemaVersion:1,sources:{...latest.cache.sources}}, live = new Set<string>();
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i], result = results[i];
    if (result.status !== 'fulfilled') continue;
    // Retain only rows that pass the same policy applied when the cache is read.
    const items = result.value.filter(isCandidate).filter(row => source.id === 'nasa' ? !!reviewedNasaItem(row.link) : !!podcastItem(row));
    // An upstream layout change or policy failure must not erase the most
    // recently usable source. A valid empty RSS is not a usable update here.
    if (!items.length) continue;
    live.add(source.id);
    if ((next.sources[source.id]?.fetchedAt || 0) > startedAt) continue;
    next.sources[source.id] = {fetchedAt:Date.now(),items};
  }
  if (live.size && latest.writable && mayCommit(options)) {
    try { const serialized = JSON.stringify(next); if (serialized.length <= MAX_CACHE) storage?.setItem(CACHE_KEY,serialized); } catch { /* unavailable or full; retain in-memory result */ }
  }
  return snapshot(next,live.size ? 'fresh' : Object.keys(next.sources).length ? 'cached' : 'offline',live);
}
