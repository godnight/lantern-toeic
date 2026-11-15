import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseProductionPhonePolicy,validatePhoneMigrationLedger,validatePhoneDatabaseState,validateLimiterCompatibility,isPrivateOwnedFile,readProductionReferenceKey} from './production-phone-preflight.candidate.mjs';
import {createRestrictedPnvsOutbound} from './production-pnvs-outbound.candidate.mjs';
import {DatabaseSync} from 'node:sqlite';
const policy=()=>({enabled:true,origin:'https://synthetic.invalid',signature:'synthetic-signature',schemeName:'synthetic',templates:{login:'100001',bind:'100004'},referenceKeyFile:'/synthetic/private/reference.key',limits:{maxSendsPerUtcDay:100,maxSendsPerMinute:10,maxSendsPerPhoneHour:3,maxVerificationsPerPhoneTenMinutes:10}});

test('production policy defaults closed and requires every explicit trusted parameter',()=>{
 assert.deepEqual(parseProductionPhonePolicy(),{enabled:false});assert.deepEqual(parseProductionPhonePolicy({enabled:false}),{enabled:false});
 assert.throws(()=>parseProductionPhonePolicy({enabled:false,signature:'unexpected'}));
 const valid=policy(),out=parseProductionPhonePolicy(valid);assert.equal(out.enabled,true);valid.limits.maxSendsPerUtcDay=1;assert.equal(out.limits.maxSendsPerUtcDay,100);
 for(const mutate of [x=>delete x.limits,x=>delete x.referenceKeyFile,x=>x.origin='http://synthetic.invalid',x=>x.origin='https://u:p@synthetic.invalid',x=>x.templates={},x=>x.templates.bind='100001',x=>x.referenceKeyFile='relative',x=>x.limits.maxSendsPerUtcDay=0,x=>x.limits.maxSendsPerUtcDay=101,x=>x.limits.maxSendsPerMinute=31,x=>x.limits.maxSendsPerPhoneHour=4,x=>x.limits.maxVerificationsPerPhoneTenMinutes=11,x=>x.unexpected='value']){
  const p=policy();mutate(p);assert.throws(()=>parseProductionPhonePolicy(p));
 }
 const runtime={sendGlobalDaily:{span:86400000,max:100},sendGlobal:{span:60000,max:10},sendPhone:{span:3600000,max:3},verifyPhone:{span:600000,max:10}};
 assert.equal(validateLimiterCompatibility(out,runtime),true);
 assert.throws(()=>validateLimiterCompatibility(out,{...runtime,sendGlobalDaily:{span:86400000,max:101}}));
 assert.throws(()=>validateLimiterCompatibility(out,{...runtime,sendGlobal:undefined}));
 assert.throws(()=>validateLimiterCompatibility({enabled:false},runtime));
});
test('migration ledger must contain both pinned hashes exactly once',async()=>{
 const names=['0007_phone_auth.sql','0008_phone_challenges.sql'];const rows=[];
 for(const name of names){const data=await readFile(new URL('../../drizzle/'+name,import.meta.url));rows.push({name,sha:createHash('sha256').update(data).digest('hex')});}
 assert.equal(validatePhoneMigrationLedger(rows),true);
 for(const bad of [[],[rows[0]],[rows[0],rows[0]],[rows[0],{...rows[1],sha:'0'.repeat(64)}],[rows[0],{...rows[1],extra:1}]])assert.throws(()=>validatePhoneMigrationLedger(bad));
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE auth_users(id TEXT PRIMARY KEY)');
  for(const name of names)db.exec(await readFile(new URL('../../drizzle/'+name,import.meta.url),'utf8'));
  const schemas=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN ('auth_phone_bindings','auth_phone_proofs','auth_phone_proofs_expiry','auth_phone_challenges','auth_phone_challenges_expiry','auth_phone_flow_buckets','auth_phone_flow_cooldowns','auth_phone_flow_operations') ORDER BY name").all();
  assert.equal(validatePhoneDatabaseState({ledgerRows:rows,schemaRows:schemas}),true);
  assert.throws(()=>validatePhoneDatabaseState({ledgerRows:rows,schemaRows:schemas.slice(1)}));
  assert.throws(()=>validatePhoneDatabaseState({ledgerRows:rows,schemaRows:schemas.map((s,i)=>i? s:{...s,sql:'tampered'})}));
 }finally{db.close();}
});
test('production preflight accepts reviewed LF and CRLF migration variants without accepting structural changes',async()=>{
 const names=['0007_phone_auth.sql','0008_phone_challenges.sql'];
 const roots=['../../drizzle/'];
 for(const root of roots){
  const sql=[];const rows=[];
  for(const name of names){const data=await readFile(new URL(root+name,import.meta.url));sql.push(data.toString('utf8'));rows.push({name,sha:createHash('sha256').update(data).digest('hex')});}
  assert.equal(validatePhoneMigrationLedger(rows),true);
  for(const style of ['lf','crlf']){
   const converted=sql.map(text=>style==='lf'?text.replace(/\r\n/g,'\n'):text.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'));
   assert.equal(validatePhoneMigrationLedger(names.map((name,i)=>({name,sha:createHash('sha256').update(converted[i]).digest('hex')}))),true);
  }
  for(const format of ['source','lf','crlf','mixed']){
   const db=new DatabaseSync(':memory:');try{
    db.exec('CREATE TABLE auth_users(id TEXT PRIMARY KEY)');
    for(let i=0;i<sql.length;i++){
     const lf=sql[i].replace(/\r\n/g,'\n');
     db.exec(format==='source'?sql[i]:format==='crlf'||(format==='mixed'&&i===1)?lf.replace(/\n/g,'\r\n'):lf);
    }
    const query="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN ('auth_phone_bindings','auth_phone_proofs','auth_phone_proofs_expiry','auth_phone_challenges','auth_phone_challenges_expiry','auth_phone_flow_buckets','auth_phone_flow_cooldowns','auth_phone_flow_operations') ORDER BY name";
    const original=db.prepare(query).all();
    assert.equal(validatePhoneDatabaseState({ledgerRows:rows,schemaRows:original}),true);
    const modified=original.map((s,i)=>i? s:{...s,sql:s.sql.replace(/\r?\n/,'\r')});
    assert.notEqual(modified[0].sql,original[0].sql);
    assert.throws(()=>validatePhoneDatabaseState({ledgerRows:rows,schemaRows:modified}));
    db.exec('DROP INDEX auth_phone_proofs_expiry');assert.throws(()=>validatePhoneDatabaseState({ledgerRows:rows,schemaRows:db.prepare(query).all()}));
   }finally{db.close();}
  }
  for(const mutation of ['column','constraint']){
   const db=new DatabaseSync(':memory:');try{
    db.exec('CREATE TABLE auth_users(id TEXT PRIMARY KEY)');
    db.exec(mutation==='constraint'?sql[0].replace('CHECK(length(proof_hash)=64)','CHECK(length(proof_hash)=63)'):sql[0]);db.exec(sql[1]);
    if(mutation==='column')db.exec('ALTER TABLE auth_phone_proofs ADD COLUMN unexpected TEXT');
    const schemas=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN ('auth_phone_bindings','auth_phone_proofs','auth_phone_proofs_expiry','auth_phone_challenges','auth_phone_challenges_expiry','auth_phone_flow_buckets','auth_phone_flow_cooldowns','auth_phone_flow_operations') ORDER BY name").all();
    assert.throws(()=>validatePhoneDatabaseState({ledgerRows:rows,schemaRows:schemas}));
   }finally{db.close();}
  }
 }
});
test('private key metadata rejects root, public access, hard links and symlinks',async()=>{
 const fixture={uid:1001,mode:0o100600,nlink:1,isFile:()=>true,isSymbolicLink:()=>false};
 assert.equal(isPrivateOwnedFile(fixture,1001),true);
 for(const s of [{...fixture,mode:0o100640},{...fixture,uid:1002},{...fixture,nlink:2},{...fixture,isSymbolicLink:()=>true}])assert.equal(isPrivateOwnedFile(s,1001),false);
 assert.equal(isPrivateOwnedFile({...fixture,uid:0},0),false);
 if(process.platform!=='linux'||process.geteuid()===0)await assert.rejects(readProductionReferenceKey('/synthetic/private/key','/synthetic/private'),/non-root Linux/);
});
test('restricted PNVS transport is opt-in, fixed endpoint and never follows redirects',async()=>{
 assert.throws(()=>createRestrictedPnvsOutbound());let count=0,mode='ok';
 const outbound=createRestrictedPnvsOutbound({enabled:true,fetchImpl:async(url,init)=>{
  count++;assert.equal(url,'https://dypnsapi.aliyuncs.com/');assert.equal(init.redirect,'manual');assert.equal(init.headers['x-acs-security-token'],'synthetic-token');
  if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://other.invalid/'}});
  if(mode==='large')return new Response('x'.repeat(65537));return Response.json({Code:'OK'});
 }});
 const headers={'host':'dypnsapi.aliyuncs.com','content-type':'application/x-www-form-urlencoded','authorization':'ACS3-HMAC-SHA256 synthetic','x-acs-action':'SendSmsVerifyCode','x-acs-content-sha256':'synthetic-hash','x-acs-date':'synthetic-time','x-acs-signature-nonce':'synthetic-nonce','x-acs-version':'2017-05-25','x-acs-security-token':'synthetic-token'};
 const req=(url='https://dypnsapi.aliyuncs.com/',changes={},body='x')=>new Request(url,{method:'POST',headers:{...headers,...changes},body});
 assert.equal((await outbound(req())).status,200);assert.equal(count,1);
 assert.equal((await outbound(req('https://other.invalid/'))).status,403);
 assert.equal((await outbound(req('https://dypnsapi.aliyuncs.com/?target=other'))).status,403);
 assert.equal((await outbound(req(undefined,{'x-acs-action':'DeleteAccount'}))).status,403);
 const noToken={...headers};delete noToken['x-acs-security-token'];assert.equal((await outbound(new Request('https://dypnsapi.aliyuncs.com/',{method:'POST',headers:noToken,body:'x'}))).status,403);
 assert.equal((await outbound(req(undefined,{},'x'.repeat(8193)))).status,502);assert.equal(count,1);
 mode='redirect';assert.equal((await outbound(req())).status,502);assert.equal(count,2);
 mode='large';assert.equal((await outbound(req())).status,502);assert.equal(count,3);
});
