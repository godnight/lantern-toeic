'use strict';
// Reuse the repository's real product auth and SQLite/R2 I/O adapter. Only
// trusted platform request accessors and Next redirects are substituted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'../..');
const fromRoot=createRequire(path.join(root,'package.json'));
const {environment:productEnvironment,ORIGIN,sha}=require(path.join(root,'tests/helpers/sites-route-harness.cjs'));
const {createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
function environment(){
 const e=productEnvironment({withoutAuth:true,env:{LANTERN_SITES_LEGACY_READONLY_ENABLED:'true',LANTERN_SITES_LEGACY_ORIGIN:ORIGIN}});
 // Stage the original 0000–0003 schema in the fresh in-memory test database.
 // The shared adapter applies 0004 too; remove only its derived schema here so
 // migration tests can seed original rows before applying the actual new SQL.
 for(const {name} of e.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'study_sync_%'").all()){
  if(!/^study_sync_[a-z_]+$/.test(name))throw Error('Unexpected test trigger');e.sqlite.exec('DROP TRIGGER '+name);
 }
 e.sqlite.exec('DROP TABLE study_sync_index; DROP TABLE study_sync_clock;');
 let ambient=new Headers(),faultAt=-1;
 const batch=e.d1.batch.bind(e.d1);
 e.d1.batch=statements=>batch(statements.map((s,i)=>i===faultAt?{_batch(){throw Error('Synthetic transaction failure');}}:s));
 const originalGet=e.bucket?.get??e.env.BUCKET.get.bind(e.env.BUCKET);
 e.env.BUCKET.get=async key=>{if(e.storage.fail)throw Error('Synthetic R2 read failure');return originalGet(key);};
 const imports={
  'cloudflare:workers':{env:e.env},
  'next/headers':{headers:async()=>ambient},
  'next/navigation':{notFound(){throw Error('NEXT_NOT_FOUND');},redirect(url){throw Object.assign(Error('NEXT_REDIRECT'),{url});}},
  'drizzle-orm/d1':fromRoot('drizzle-orm/d1'),
 };
 const loader=createSourceLoader({root,imports});
 return {...e,load:loader.load,ambient(headers){ambient=new Headers(headers);e.setAmbientHeaders(headers);},fault(i){faultAt=i;},request(route,query='',headers={}){return new Request(ORIGIN+'/api/legacy/'+route+query,{headers});},pageLoader(extra={}){return createSourceLoader({root,imports:{...imports,...extra}});}};
}
function migrate(e){for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(n=>/^000[4-8].*\.sql$/.test(n)).sort())e.sqlite.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));}
function syntheticLegacy(e,owner='sites-synthetic-A',packs=12){
 e.sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run(owner,'{"name":"Synthetic original profile","theme":"paper"}','2026-01-01');
 for(let i=0;i<3;i++)e.sqlite.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)').run(owner+'-attempt-'+i,owner,'unchanged-qid-'+i,i%4,i%2,'2026-01-01',4,'first');
 for(let i=0;i<packs;i++){const id=crypto.randomUUID(),body=Buffer.from('{"title":"Synthetic owned package '+i+'"}'),key='synthetic-only/'+owner+'/'+id; e.sqlite.prepare('INSERT INTO exam_library VALUES(?,?,?,?,?,?,?,?)').run(id,owner,key,JSON.stringify({title:'Synthetic package '+i}),body.length,sha(body),'ready','2026-01-01');e.objects.set(key,{bytes:body,httpMetadata:{contentType:'application/json'}});}
 return owner;
}
module.exports={root,ORIGIN,sha,environment,migrate,syntheticLegacy};
