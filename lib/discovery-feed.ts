import catalog from '../content/discovery-native.json';
import { readRssItems } from './discovery-rss-stream.mjs';
import type { DiscoveryItem, DiscoveryFeedOptions, DiscoveryFeedSnapshot, DiscoverySourceMode, DiscoveryRefreshSummary } from './discovery-feed-contract';

type Candidate = { guid: string | null; link: string | null; title: string | null; publishedAt: string | null; language: string | null; description: string | null; descriptionTruncated: boolean };
type SourceCache = { fetchedAt: number; items: Candidate[] };
type SourceId = 'nasa' | '99pi' | 'cgtn-roundtable' | 'cgtn-beijing-hour' | 'cgtn-world-today';
type Cache = { schemaVersion: 2; sources: Partial<Record<SourceId, SourceCache>> };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const CACHE_KEY = 'lantern-discovery-public-feed-v1';
const MAX_CACHE = 512 * 1024;
const SOURCES = [
  { id: 'cgtn-roundtable' as const, label: 'Round Table China', url: 'https://cgtn-radio-data.cgtn.com/rss/program/11' },
  { id: 'cgtn-beijing-hour' as const, label: 'The Beijing Hour', url: 'https://cgtn-radio-data.cgtn.com/rss/program/5' },
  { id: 'cgtn-world-today' as const, label: 'World Today', url: 'https://cgtn-radio-data.cgtn.com/rss/program/46' },
  { id: 'nasa' as const, label: 'NASA', url: 'https://www.nasa.gov/feed/' },
  { id: '99pi' as const, label: '99% Invisible', url: 'https://feeds.simplecast.com/BqbsxVfO' },
];
const SOURCE_IDS = SOURCES.map(source => source.id);
// NASA is a hand-reviewed collection, not an automatically admitted feed.
const DYNAMIC_SOURCES = SOURCES.filter(source => source.id !== 'nasa');
const hasDynamicCache = (cache:Cache) => DYNAMIC_SOURCES.some(source => !!cache.sources[source.id]);
const LEGACY_SOURCE_IDS: readonly SourceId[] = ['nasa','99pi'];
const OTHER_SOURCES = [ {id:'stanford',label:'Stanford'}, {id:'blender',label:'Blender'}, {id:'guardian',label:'The Guardian'}, {id:'ted',label:'TED'} ];
const DEFAULT_CACHE: Cache = { schemaVersion: 2, sources: {} };
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
type CgtnSourceId = Extract<SourceId, `cgtn-${string}`>;
const CGTN_PROGRAMS: Record<CgtnSourceId, {label:string; url:string; feed:string; shortId:string}> = {
  'cgtn-roundtable': {label:'Round Table China',url:'https://radio.cgtn.com/podcast/column/ezfm/Round-Table-China/11',feed:'https://cgtn-radio-data.cgtn.com/rss/program/11',shortId:'rt'},
  'cgtn-beijing-hour': {label:'The Beijing Hour',url:'https://radio.cgtn.com/podcast/column/ezfm/The-Beijing-Hour/5',feed:'https://cgtn-radio-data.cgtn.com/rss/program/5',shortId:'bh'},
  'cgtn-world-today': {label:'World Today',url:'https://radio.cgtn.com/podcast/column/ezfm/World-Today/46',feed:'https://cgtn-radio-data.cgtn.com/rss/program/46',shortId:'wt'},
};
function validOriginalLanguage(row: Candidate): boolean {
  if (row.language !== null && !/^en(?:[-_][a-z0-9]+)*$/i.test(row.language)) return false;
  const text = (row.title + ' ' + (row.description || '')).normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\b(?:translated\s+)?(?:subtitles?|captions?)(?:\s+(?:translated\s+)?(?:into|in|to)\s+[a-z]+)?\b/gi, ' ');
  return !/中文配音|中配|AI配音|机器翻译|译配|\btranslat(?:ed|ion)\b|\bdubb(?:ed|ing)\b|(?:audio|voice|narrat(?:ion|ed))\s+(?:in\s+)?(?:mandarin|chinese|spanish|french)\b|\ben español\b|\ben français\b/i.test(text);
}
function cgtnItem(sourceId:CgtnSourceId, row:Candidate): DiscoveryItem | null {
  const program = CGTN_PROGRAMS[sourceId];
  const match = row.guid && /^1_([0-9]{1,12})$/.exec(row.guid);
  if (!match || !row.title || row.title.length > 500 || row.descriptionTruncated || !validOriginalLanguage(row) || !row.publishedAt) return null;
  const timestamp = Date.parse(row.publishedAt);
  if (!Number.isFinite(timestamp)) return null;
  return { id:`cgtn-${program.shortId}-${match[1]}`,kind:'podcast',title:row.title,publishedAt:new Date(timestamp).toISOString(),author:null,
    publisher:'CGTN Radio',platform:'CGTN Radio',sourceId,sourceUrl:program.url,tags:['News','Culture'],durationLabel:null,language:'en',originalLanguage:'en',cover:null,
    verification:{checkedAt:'2026-11-17',basis:'Publisher-declared English-language program; this episode has not been individually auditioned. Opens the official program page, where the episode can be found by title.',evidenceUrls:[program.url,program.feed]} };
}
function itemForSource(sourceId:SourceId, row:Candidate): DiscoveryItem | undefined | null {
  if (sourceId === 'nasa') return row.language === null || /^en(?:[-_][a-z0-9]+)*$/i.test(row.language) ? reviewedNasaItem(row.link) : undefined;
  if (sourceId === '99pi') return podcastItem(row);
  return cgtnItem(sourceId,row);
}
function podcastItem(row: Candidate): DiscoveryItem | null {
  if (!row.guid || !UUID.test(row.guid) || !row.title || row.title.length > 500 || !podUrl(row.link) || row.descriptionTruncated) return null;
  if (!validOriginalLanguage(row)) return null;
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
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.sourceUrl !== 'string') return null;
  if (row.id.startsWith('99pi-')) {
    const item = podcastItem({guid:row.id.slice(5),title:row.title,link:row.sourceUrl,publishedAt:null,language:null,description:null,descriptionTruncated:false});
    return item && item.id === row.id ? item : null;
  }
  for (const sourceId of Object.keys(CGTN_PROGRAMS) as CgtnSourceId[]) {
    const program = CGTN_PROGRAMS[sourceId], prefix = `cgtn-${program.shortId}-`;
    if (!row.id.startsWith(prefix) || row.sourceUrl !== program.url || typeof row.publishedAt !== 'string') continue;
    const item = cgtnItem(sourceId,{guid:'1_'+row.id.slice(prefix.length),title:row.title,link:null,publishedAt:row.publishedAt,language:null,description:null,descriptionTruncated:false});
    if (item && item.id === row.id && item.publishedAt === row.publishedAt) return item;
  }
  return null;
}
function readStoredCache(storage: StorageLike | null): { cache: Cache; writable: boolean } {
  if (!storage) return {cache:DEFAULT_CACHE,writable:false};
  try {
    const raw = storage.getItem(CACHE_KEY); if (raw === null) return {cache:DEFAULT_CACHE,writable:true};
    if (raw.length > MAX_CACHE) return {cache:DEFAULT_CACHE,writable:false};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {cache:DEFAULT_CACHE,writable:false};
    const p = parsed as Record<string, unknown>;
    if ((p.schemaVersion !== 1 && p.schemaVersion !== 2) || !p.sources || typeof p.sources !== 'object' || Array.isArray(p.sources)) return {cache:DEFAULT_CACHE,writable:false};
    const incoming = p.sources as Record<string, unknown>, sources: Cache['sources'] = {};
    const permitted: readonly string[] = p.schemaVersion === 1 ? LEGACY_SOURCE_IDS : SOURCE_IDS;
    if (Object.keys(incoming).some(k => !permitted.includes(k))) return {cache:DEFAULT_CACHE,writable:false};
    for (const id of SOURCE_IDS) {
      const value = incoming[id]; if (value === undefined) continue;
      if (!value || typeof value !== 'object') return {cache:DEFAULT_CACHE,writable:false};
      const v = value as Record<string, unknown>;
      if (typeof v.fetchedAt !== 'number' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.items) || v.items.length > 50 || !v.items.every(isCandidate)) return {cache:DEFAULT_CACHE,writable:false};
      sources[id] = { fetchedAt:v.fetchedAt, items:v.items as Candidate[] };
    }
    return {cache:{schemaVersion:2,sources},writable:true};
  } catch { return {cache:DEFAULT_CACHE,writable:false}; }
}
// Retain successful public feed data for this runtime when storage is blocked,
// full, or protected by a newer schema. Never rewrite those protected bytes.
const transientByStorage = new WeakMap<object, Cache>();
let transientWithoutStorage: Cache | undefined;
// Ordering is runtime-only: wall-clock completion time is not a request revision.
const revisionsByStorage = new WeakMap<object, Map<SourceId,number>>();
const revisionsWithoutStorage = new Map<SourceId,number>();
let requestRevision = 0;
function revisionsFor(storage: StorageLike | null): Map<SourceId,number> {
  if (!storage) return revisionsWithoutStorage;
  let revisions = revisionsByStorage.get(storage);
  if (!revisions) { revisions = new Map(); revisionsByStorage.set(storage,revisions); }
  return revisions;
}
function readCache(storage: StorageLike | null): { cache: Cache; writable: boolean } {
  const stored = readStoredCache(storage);
  const transient = storage ? transientByStorage.get(storage) : transientWithoutStorage;
  if (!transient) return stored;
  const sources = {...stored.cache.sources};
  for (const id of SOURCE_IDS) {
    const current = sources[id], temporary = transient.sources[id];
    if (temporary && (!current || temporary.fetchedAt > current.fetchedAt)) sources[id] = temporary;
  }
  return {cache:{schemaVersion:2,sources},writable:stored.writable};
}
function rememberTransient(storage: StorageLike | null, cache: Cache): void {
  if (storage) transientByStorage.set(storage,cache); else transientWithoutStorage = cache;
}
function snapshot(cache: Cache, mode: 'seed' | 'fresh' | 'cached' | 'offline', live = new Set<string>(), refresh: DiscoveryRefreshSummary | null = null): DiscoveryFeedSnapshot {
  const added: DiscoveryItem[] = [];
  for (const sourceId of SOURCE_IDS) for (const row of cache.sources[sourceId]?.items || []) { const item = itemForSource(sourceId,row); if (item) added.push(item); }
  // Live episodes lead; reviewed material remains available and deduplicated.
  const entries: DiscoveryItem[] = [], ids = new Set<string>(), urls = new Set<string>();
  const seedIds = new Set(DISCOVERY_SEED.map(item => item.id));
  for (const item of [...added.filter(item => !seedIds.has(item.id)),...added.filter(item => seedIds.has(item.id)),...DISCOVERY_SEED]) {
    if (!item || ids.has(item.id) || (!item.sourceId.startsWith('cgtn-') && urls.has(item.sourceUrl))) continue;
    ids.add(item.id); if (!item.sourceId.startsWith('cgtn-')) urls.add(item.sourceUrl); entries.push(item);
  }
  const sources = SOURCES.map(s => ({id:s.id,label:s.label,mode:(s.id === 'nasa' ? 'curated' : live.has(s.id) ? 'live' : cache.sources[s.id] ? 'cached' : mode === 'seed' ? 'curated' : 'offline') as DiscoverySourceMode}));
  const times = DYNAMIC_SOURCES.map(s => cache.sources[s.id]?.fetchedAt).filter((time): time is number => time !== undefined);
  const lastSuccessAt = times.length ? Math.max(...times) : null;
  return {entries,sources:[...sources,...OTHER_SOURCES.map(s => ({...s,mode:'curated' as const}))],status:mode,refreshedAt:lastSuccessAt,lastSuccessAt,refresh};
}
export function readDiscoveryFeedCache(storage?: StorageLike | null): DiscoveryFeedSnapshot {
  const {cache} = readCache(storageFor(storage));
  return snapshot(cache,hasDynamicCache(cache) ? 'cached' : 'seed');
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
      // Some public servers close a response mid-document. Retry at most once
      // within the same overall timeout; never accept a partially scanned RSS.
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetcher(source.url,{signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/rss+xml, application/xml, text/xml'}});
          const rows = await readRssItems(response,{signal:controller.signal,scanToEnd:true});
          const channelLanguage = (rows as typeof rows & {channelLanguage:string|null}).channelLanguage;
          // CGTN admission requires the specific reviewed English-language
          // program and a compatible explicit channel declaration.
          if ((source.id.startsWith('cgtn-') && channelLanguage === null) || (channelLanguage !== null && !/^en(?:[-_][a-z0-9]+)*$/i.test(channelLanguage))) throw new Error('Feed language conflicts with source policy');
          return rows;
        } catch (error) {
          if (attempt || controller.signal.aborted) throw error;
        }
      }
    })();
    return await Promise.race([work,cancellation]);
  } finally { clearTimeout(timer); outer?.removeEventListener('abort',cancel); }
}
export async function refreshDiscoveryFeed(options: DiscoveryFeedOptions = {}): Promise<DiscoveryFeedSnapshot> {
  const storage = storageFor(options.storage), initial = readCache(storage);
  if (!mayCommit(options)) return snapshot(initial.cache,hasDynamicCache(initial.cache) ? 'cached' : 'seed');
  const startedAt = nextStartedAt(), revision = ++requestRevision;
  const fetcher = options.fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
  if (!fetcher) return snapshot(initial.cache,hasDynamicCache(initial.cache) ? 'cached' : 'offline',new Set(),{outcome:'failed',added:0,attemptedAt:startedAt});
  const results = await Promise.allSettled(DYNAMIC_SOURCES.map(source => fetchSource(source,fetcher,options.signal)));
  if (!mayCommit(options)) return snapshot(initial.cache,hasDynamicCache(initial.cache) ? 'cached' : 'seed');
  const latest = readCache(storage), next: Cache = {schemaVersion:2,sources:{...latest.cache.sources}}, live = new Set<string>();
  const revisions = revisionsFor(storage);
  const before = new Set(snapshot(latest.cache,'cached').entries.map(item => item.id));
  for (let i = 0; i < DYNAMIC_SOURCES.length; i++) {
    const source = DYNAMIC_SOURCES[i], result = results[i];
    if (result.status !== 'fulfilled') continue;
    // Retain only rows that pass the same policy applied when the cache is read.
    const items = result.value.filter(isCandidate).filter(row => !!itemForSource(source.id,row));
    // An upstream layout change or policy failure must not erase the most
    // recently usable source. A valid empty RSS is not a usable update here.
    if (!items.length) continue;
    live.add(source.id);
    if ((revisions.get(source.id) || 0) > revision) continue;
    revisions.set(source.id,revision);
    // Put newly admitted IDs first, then retain the previous stable ordering.
    const itemFor = (row: Candidate) => itemForSource(source.id,row);
    const previous = next.sources[source.id]?.items || [];
    const byId = new Map<string,Candidate>();
    for (const row of items) { const item = itemFor(row); if (item && !byId.has(item.id)) byId.set(item.id,row); }
    const oldIds = previous.map(itemFor).filter((item): item is DiscoveryItem => !!item).map(item => item.id);
    const orderedIds = [...byId.keys()].filter(id => !oldIds.includes(id)).concat(oldIds.filter(id => byId.has(id)));
    next.sources[source.id] = {fetchedAt:Math.max(Date.now(),startedAt),items:[...new Set(orderedIds)].map(id => byId.get(id)!)};
  }
  if (live.size && latest.writable && mayCommit(options)) {
    try { const serialized = JSON.stringify(next); if (serialized.length <= MAX_CACHE) storage?.setItem(CACHE_KEY,serialized); } catch { /* unavailable or full; retain in-memory result */ }
  }
  if (live.size && mayCommit(options)) rememberTransient(storage,next);
  const mode = live.size ? 'fresh' : hasDynamicCache(next) ? 'cached' : 'offline';
  const added = snapshot(next,mode,live).entries.filter(item => !before.has(item.id)).length;
  const outcome = !live.size ? 'failed' : live.size < DYNAMIC_SOURCES.length ? 'partial' : added ? 'updated' : 'unchanged';
  return snapshot(next,mode,live,{outcome,added,attemptedAt:startedAt});
}
// Give overlapping requests in this runtime a strict ordering even in the same millisecond.
let lastStartedAt = 0;
function nextStartedAt(): number { lastStartedAt = Math.max(Date.now(),lastStartedAt + 1); return lastStartedAt; }
