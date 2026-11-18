'use strict';
// Actual feed/parser code; all provider responses and storage are synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
const NASA='https://www.nasa.gov/feed/', POD='https://feeds.simplecast.com/BqbsxVfO', CGTN=['https://cgtn-radio-data.cgtn.com/rss/program/11','https://cgtn-radio-data.cgtn.com/rss/program/5','https://cgtn-radio-data.cgtn.com/rss/program/46'];
const {TextEncoder}=require('node:util');
const item=(guid,link,title,extra='')=>`<item><guid>${guid}</guid><link>${link}</link><title>${title}</title>${extra}</item>`;
const rss=items=>`<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="urn:dc" xmlns:itunes="urn:itunes"><channel><title>Official feed</title>${items}</channel></rss>`;
function response(xml,chunkSize=37){const bytes=new TextEncoder().encode(xml);let pos=0;return new Response(new ReadableStream({pull(c){if(pos>=bytes.length)return c.close();const end=Math.min(pos+chunkSize,bytes.length);c.enqueue(bytes.slice(pos,end));pos=end;}}),{status:200,headers:{'content-type':'application/rss+xml'}});}
function memory(initial={}){const m=new Map(Object.entries(initial)),writes=[];return {m,writes,getItem:k=>m.get(k)??null,setItem(k,v){writes.push([k,String(v)]);m.set(k,String(v));}};}
const sources=()=>createSourceLoader({root}).load('lib/discovery-feed.ts');
function fakeFetch(nasa,podcast,calls=[]){return async(url,options)=>{const u=String(url);calls.push({url:u,credentials:options?.credentials,headers:options?.headers});assert.equal(options?.credentials,'omit');if(u===NASA){if(nasa instanceof Error)throw nasa;return response(nasa);}if(u===POD){if(podcast instanceof Error)throw podcast;return response(podcast);}if(CGTN.includes(u))return response(rss('<language>en</language>'));throw Error('Unexpected network target: '+u);};}
const NASA_ITEM=item('nasa-unique','https://www.nasa.gov/image-article/gemini-astronaut-photos-inspired-early-earth-observation-program/','Gemini Astronaut Photos Inspired Early Earth Observation Program');
const UUID_A='beeff00d-1111-4111-8111-111111111111',UUID_B='beeff00d-2222-4222-8222-222222222222';
const EP_A=item(UUID_A,'https://99percentinvisible.org/episode/invisible-city/','An English original episode','<description>We explore a city in English.</description>');
const EP_B=item(UUID_B,'https://99percentinvisible.org/episode/another-city/','A new English episode','<description>Originally presented in English.</description>');

test('refresh summary distinguishes actual new IDs, unchanged sources, partial and offline results',async()=>{
 const feed=sources(),store=memory();
 const initial=feed.readDiscoveryFeedCache(store);assert.equal(initial.refresh,null);assert.equal(initial.lastSuccessAt,null);
 const first=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A))});
 assert.equal(first.refresh.outcome,'partial');assert.equal(first.refresh.added,1);assert(first.refresh.attemptedAt>0);assert(first.lastSuccessAt>=first.refresh.attemptedAt);
 assert.equal(first.entries[0].id,'99pi-'+UUID_A);assert.equal(new Set(first.entries.map(x=>x.id)).size,first.entries.length);
 const unchanged=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A+EP_A))});
 assert.equal(unchanged.refresh.outcome,'partial');assert.equal(unchanged.refresh.added,0);
 const partial=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),rss(EP_A+EP_B))});
 assert.equal(partial.refresh.outcome,'partial');assert.equal(partial.refresh.added,1);assert.equal(partial.entries[0].id,'99pi-'+UUID_B);
 const same=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A+EP_B))});
 assert.equal(same.refresh.outcome,'partial');assert.equal(same.refresh.added,0);assert.equal(same.entries[0].id,'99pi-'+UUID_B,'newer entries retain priority after unchanged refresh');
 const offline=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),new Error('offline'))});
 assert.equal(offline.refresh.outcome,'failed');assert.equal(offline.refresh.added,0);assert.equal(offline.lastSuccessAt,same.lastSuccessAt);assert(offline.entries.some(x=>x.id==='99pi-'+UUID_B));
 const cached=feed.readDiscoveryFeedCache(store);assert.equal(cached.refresh,null);assert.equal(cached.lastSuccessAt,same.lastSuccessAt);assert.equal(cached.entries[0].id,'99pi-'+UUID_B);
});

test('a later completed refresh prevents an older response from replacing its source or claiming new entries',async()=>{
 const feed=sources(),store=memory(),pending=[];
 const delayed=(url)=>CGTN.includes(String(url))?Promise.resolve(response(rss('<language>en</language>'))):new Promise(resolve=>pending.push({url:String(url),resolve}));
 const earlier=feed.refreshDiscoveryFeed({storage:store,fetchImpl:delayed});
 const later=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_B))});
 assert.equal(later.refresh.added,1);
 for(const p of pending)p.resolve(response(p.url===NASA?rss(NASA_ITEM):rss(EP_A)));
 const older=await earlier;assert.equal(older.refresh.outcome,'partial');assert.equal(older.refresh.added,0);
 assert(older.entries.some(x=>x.id==='99pi-'+UUID_B));assert(!older.entries.some(x=>x.id==='99pi-'+UUID_A));
 assert(feed.readDiscoveryFeedCache(store).entries.some(x=>x.id==='99pi-'+UUID_B));
});

test('unwritable storage keeps a runtime baseline without changing protected bytes',async()=>{
 const feed=sources(),raw=JSON.stringify({schemaVersion:999,sources:{}});let writes=0;
 const storage={getItem:()=>raw,setItem(){writes++;throw Error('not writable');}};
 const first=await feed.refreshDiscoveryFeed({storage,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A))});
 assert.equal(first.refresh.outcome,'partial');assert.equal(first.refresh.added,1);
 const second=await feed.refreshDiscoveryFeed({storage,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A))});
 assert.equal(second.refresh.outcome,'partial');assert.equal(second.refresh.added,0);assert.equal(writes,0);assert.equal(storage.getItem(),raw);
 const offline=await feed.refreshDiscoveryFeed({storage,fetchImpl:fakeFetch(new Error('offline'),new Error('offline'))});
 assert.equal(offline.refresh.outcome,'failed');assert(offline.entries.some(x=>x.id==='99pi-'+UUID_A));
});

test('stream parser handles split UTF-8 and reads only direct item fields, not CDATA decoys',async()=>{
 const {readRssItems}=await import('../lib/discovery-rss-stream.mjs');
 const body=rss(item('real-guid','https://example.org/real?a=1&amp;b=2','A &amp; B \ud83d\ude80',`<description><![CDATA[Chinese \u4e2d <guid>counterfeit-guid</guid><link>https://evil.invalid/</link>]]></description><language>en-US</language><enclosure url="https://evil.invalid/audio.mp3"/><itunes:image href="https://evil.invalid/image.jpg"/>`));
 const rows=await readRssItems(response(body,1),{yieldEvery:1});assert.equal(rows.length,1);const row=rows[0];
 assert.equal(row.guid,'real-guid');assert.equal(row.link,'https://example.org/real?a=1&b=2');assert.equal(row.title,'A & B \ud83d\ude80');assert.equal(row.language,'en-US');assert.match(row.description,/Chinese/);
 assert.equal(row.descriptionTruncated,false);assert(!Object.hasOwn(row,'enclosure'));assert(!Object.hasOwn(row,'image'));
 const decoy=await readRssItems(response(rss('<item><description><![CDATA[<guid>fake</guid><link>https://evil.invalid</link>]]></description><title>Real title</title></item>'),3));
 assert.equal(decoy[0].guid,null);assert.equal(decoy[0].link,null);
});

test('parser rejects unsafe declarations, broken XML and resource overflows without returning partial results',async()=>{
 const {readRssItems}=await import('../lib/discovery-rss-stream.mjs');
 const good=item('one','https://example.org/one','First');
 for(const xml of [`<!DOCTYPE rss [<!ENTITY x "bad">]>${rss(good)}`,rss(good).replace('</channel>','</wrong>'),rss(good).replace('</rss>','')]){
  await assert.rejects(()=>readRssItems(response(xml,5)));
 }
 await assert.rejects(()=>readRssItems(response(rss(item('x','https://example.org/x','Y'.repeat(6000))),32),{maxItemBytes:1024}));
 await assert.rejects(()=>readRssItems(response(rss(good.repeat(20)),32),{maxBytes:512,maxItems:50}));
 const limited=await readRssItems(response(rss(good.repeat(5)),19),{maxItems:2});assert.equal(limited.length,2);
 const longDescription=await readRssItems(response(rss(item('x','https://example.org/x','Long description',`<description>${'a'.repeat(6000)}</description>`)),300));
 assert(longDescription[0].descriptionTruncated);assert(longDescription[0].description.length<=3000);
});

test('real catalog seeds have English-original evidence, old favorite ids and per-asset cover proof',()=>{
 const feed=sources(),seeds=feed.DISCOVERY_SEED;assert(seeds.length>3);
 for(const id of ['nasa-kennedy-rice-1962','stanford-jobs-2005','blender-tears-of-steel'])assert(seeds.some(e=>e.id===id),id);
 for(const entry of seeds){assert.equal(entry.language,'en');assert.equal(entry.originalLanguage,'en');assert(entry.title);assert(entry.verification.basis);assert(entry.verification.evidenceUrls.length);for(const url of [entry.sourceUrl,...entry.verification.evidenceUrls])assert.equal(new URL(url).protocol,'https:');if(entry.cover){assert(entry.cover.src.startsWith('/images/discovery/'));assert(entry.cover.credit);assert.equal(new URL(entry.cover.evidenceUrl).protocol,'https:');}}
 assert(!seeds.some(e=>/bilibili-chinese-dub-ted-ed|aeon-fugitive-imagination/.test(e.id)));
});

test('real refresh accepts reviewed NASA and a source-policy 99pi episode while rejecting dubious audio and unsafe sources',async()=>{
 const feed=sources(),store=memory(),calls=[];
 const podcast=rss(EP_A+
 item('beeff00d-3333-4333-8333-333333333333','https://99percentinvisible.org/episode/dubbed/','A famous TED Talk','<language>zh-CN</language><description>\u4e2d\u6587\u914d\u97f3</description>')+
 item('beeff00d-4444-4444-8444-444444444444','https://99percentinvisible.org/episode/translated/','New English title','<description>Translated and dubbed into English</description>')+
 item('beeff00d-4444-4444-8444-444444444445','https://99percentinvisible.org/episode/encoded-dub/','Encoded dubbing','<description><![CDATA[&#20013;&#25991;&#37197;&#38899;]]></description>')+
 item('beeff00d-5555-4555-8555-555555555555','https://99percentinvisible.org.evil.invalid/episode/no/','Evil source')+
 item('beeff00d-6666-4666-8666-666666666666','https://user:password@99percentinvisible.org/episode/no/','Credentials URL')+
 item('','https://99percentinvisible.org/episode/no/','Missing stable id')+
 item('beeff00d-7777-4777-8777-777777777777','https://99percentinvisible.org/episode/no/',''));
 const nasa=rss(NASA_ITEM+item('unreviewed','https://www.nasa.gov/not-reviewed/','Unknown original language')+NASA_ITEM);
 const result=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(nasa,podcast,calls),canCommit:()=>true});
 assert.equal(new Set(calls.map(x=>x.url)).size,4);assert.deepEqual(new Set(calls.map(x=>x.url)),new Set([POD,...CGTN]));assert(calls.every(x=>x.credentials==='omit'));
 assert(result.entries.some(e=>e.id==='nasa-gemini-earth-observation'));assert.equal(result.entries.filter(e=>e.id==='nasa-gemini-earth-observation').length,1);
 const fresh=result.entries.find(e=>e.title==='An English original episode');assert(fresh,'an actual unlisted episode from the reviewed program can enter after successful feed fetch');
 assert.equal(fresh.kind,'podcast');assert.equal(fresh.sourceId,'99pi');assert.equal(fresh.author,null);assert.equal(fresh.language,'en');assert.equal(fresh.originalLanguage,'en');assert(fresh.verification.basis);assert(fresh.verification.evidenceUrls.some(u=>u.includes('99percentinvisible.org')));
 for(const title of ['A famous TED Talk','New English title','Encoded dubbing','Evil source','Credentials URL','Missing stable id','Unknown original language'])assert(!result.entries.some(e=>e.title===title),title);
 assert(!result.entries.some(e=>String(e.sourceUrl).includes('evil.invalid')));assert(result.sources.some(s=>s.id==='99pi'&&s.mode==='live'));
});

test('last valid source results survive offline or partial failure and corrupt/future cache bytes are never overwritten',async()=>{
 const feed=sources(),store=memory();
 const first=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A)),canCommit:()=>true});
 assert(first.entries.some(e=>e.title==='An English original episode'));assert(store.writes.length>0,'successful refresh should persist non-personal reviewed feed data');
 const key=store.writes.at(-1)[0],saved=store.m.get(key);assert(saved);
 const offline=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),new Error('offline')),canCommit:()=>true});
 assert(offline.entries.some(e=>e.title==='An English original episode'));assert(offline.sources.some(s=>s.id==='99pi'&&s.mode==='cached'));assert.equal(store.m.get(key),saved,'failed refresh must retain last successful bytes');
 const empty=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(''),rss(item('bogus','https://evil.invalid/','Unusable'))),canCommit:()=>true});
 assert.equal(empty.status,'cached');assert(empty.entries.some(e=>e.title==='An English original episode'));assert.equal(store.m.get(key),saved,'a response with no admitted items must not erase last successful sources');
 const httpError=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:async()=>new Response('unavailable',{status:503}),canCommit:()=>true});
 assert.equal(httpError.status,'cached');assert.equal(store.m.get(key),saved,'HTTP failure must retain the cache');
 const nasaSpoof=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(item('bad','https://evil.invalid/path','Counterfeit NASA')+item('missing','','No NASA link')),new Error('offline')),canCommit:()=>true});
 assert.equal(nasaSpoof.status,'cached');assert.equal(store.m.get(key),saved,'invalid NASA URL keys must not be treated as reviewed');assert(!nasaSpoof.entries.some(e=>e.title==='Counterfeit NASA'));
 const partial=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),rss(EP_B+EP_A)),canCommit:()=>true});
 assert(partial.entries.some(e=>e.title==='A new English episode'));assert(partial.entries.some(e=>e.title==='An English original episode'));assert(partial.sources.some(s=>s.id==='nasa'&&s.mode==='curated'));assert(partial.sources.some(s=>s.id==='99pi'&&s.mode==='live'));
 for(const raw of ['{broken',JSON.stringify({schemaVersion:999,sources:{}})]){store.m.set(key,raw);store.writes.length=0;await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A)),canCommit:()=>true});assert.equal(store.m.get(key),raw);assert.equal(store.writes.length,0,'unknown/corrupt cache must remain untouched');}
});

test('aborted or stale owner request cannot commit after a fetch ignores cancellation',async()=>{
 const feed=sources(),store=memory();let permit=true;const pending=[];
 const fetchImpl=(url,options)=>new Promise(resolve=>{pending.push({url:String(url),resolve,options});});
 const controller=new AbortController();const refreshing=feed.refreshDiscoveryFeed({storage:store,fetchImpl,signal:controller.signal,canCommit:()=>permit});
 await new Promise(resolve=>setTimeout(resolve,0));permit=false;controller.abort();
 const settled=await Promise.race([refreshing,new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);assert(settled,'abort should settle even if a provider ignores its signal');assert.equal(settled.refresh,null);
 for(const p of pending)p.resolve(response(p.url===NASA?rss(NASA_ITEM):rss(EP_A)));
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(store.writes.length,0);assert.equal(store.m.size,0);
});

test('channel-level non-English conflicts reject a source and preserve cache, even after item limit',async()=>{
 const feed=sources(),store=memory();
 const first=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(rss(NASA_ITEM),rss(EP_A)),canCommit:()=>true});
 assert(first.entries.some(e=>e.title==='An English original episode'));const prior=store.writes.at(-1)[1];
 const chinese=rss('<language>zh-CN</language>'+EP_B);
 const conflict=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),chinese),canCommit:()=>true});
 assert.equal(conflict.status,'cached');assert(!conflict.entries.some(e=>e.title==='A new English episode'));assert.equal(store.writes.at(-1)[1],prior);
 const afterLimit=rss(EP_B.repeat(51)+'<language>zh-CN</language>');
 const late=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),afterLimit),canCommit:()=>true});
 assert.equal(late.status,'cached');assert(!late.entries.some(e=>e.title==='A new English episode'));assert.equal(store.writes.at(-1)[1],prior);
 const subtitles=item(UUID_B,'https://99percentinvisible.org/episode/another-city/','A new English episode','<language>en-US</language><description>English original with subtitles translated into Chinese.</description>');
 const accepted=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),rss('<language>en</language>'+subtitles)),canCommit:()=>true});
 assert(accepted.entries.some(e=>e.title==='A new English episode'));
 const explicitItem=item(UUID_B,'https://99percentinvisible.org/episode/another-city/','A new English episode','<language>zh</language>');
 const itemRejected=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),rss('<language>en</language>'+explicitItem)),canCommit:()=>true});
 assert.equal(itemRejected.status,'cached');
 const malformed=item(UUID_B,'https://99percentinvisible.org/episode/another-city/','Invalid language','<language><bad>en</bad></language>');
 const malformedRejected=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fakeFetch(new Error('offline'),rss('<language>en</language>'+malformed)),canCommit:()=>true});
 assert.equal(malformedRejected.status,'cached');assert(!malformedRejected.entries.some(e=>e.title==='Invalid language'));
});
