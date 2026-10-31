import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareAuthTest,prepareFromFiles,PRODUCTION_PROJECT,PRODUCTION_HOST,LOCAL_DATABASE} from '../tools/auth-local/prepare.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
// Synthetic review forms only: these are NOT allocated Sites/D1 resources.
function fixture(){
 const accountId='synthetic-account-review',project='appgprj_b8c70f1ae25d49308ab6d142f376ca95';
 const db='b97152c0-a845-46ec-9c80-1f762d49a3e6',prodDb='79af52d0-e861-4b3f-8d2c-74be951c6a08';
 const target={schemaVersion:1,platform:'sites',purpose:'isolated-auth-test',accountId,projectId:project,origin:'https://auth-test-fixture.chatgpt.site',database:{id:db,name:'lantern-auth-test-fixture',binding:'DB'},vars:{LANTERN_AUTH_ENABLED:'false'},dataPolicy:'synthetic-only-empty'};
 const inventory={schemaVersion:1,platform:'sites',accountId,observedAt:new Date().toISOString(),evidenceKind:'synthetic-fixture',evidenceRefs:['synthetic-review-20261031'],
  projects:[{id:PRODUCTION_PROJECT,accountId,name:'lantern-toeic',purpose:'production',hostname:PRODUCTION_HOST,databaseId:prodDb,databaseBinding:'DB'},{id:project,accountId,name:'lantern-auth-test-fixture',purpose:'isolated-auth-test',hostname:'auth-test-fixture.chatgpt.site',databaseId:db,databaseBinding:'DB'}],
  databases:[{id:prodDb,accountId,name:'lantern-toeic',purpose:'production',projectIds:[PRODUCTION_PROJECT]},{id:db,accountId,name:'lantern-auth-test-fixture',purpose:'isolated-auth-test',projectIds:[project]}]};
 return {target,inventory};
}
test('complete matching synthetic inventory produces only an explicitly blocked offline plan',()=>{
 const {target,inventory}=fixture(),before=JSON.stringify({target,inventory});
 const plan=prepareAuthTest(target,inventory);
 assert.equal(plan.status,'PLAN_ONLY');assert.equal(plan.ready,false);assert.equal(plan.applySupported,false);
 assert.equal(plan.evidenceKind,'synthetic-fixture');assert.equal(plan.externalVerification,'NOT_VERIFIED');
 assert.equal(plan.requiredConfiguration.LANTERN_AUTH_ENABLED,'false');assert.equal(plan.requiredConfiguration.nativeAuthOrigin,'KEEP_EMPTY');
 assert(plan.blockers.includes('AUTH_ONLY_DEPLOY_INPUT_NOT_AVAILABLE'));assert(plan.nextSteps.some(step=>step.includes('不上传完整Web/Shared')));
 assert.equal(JSON.stringify({target,inventory}),before);
});
test('missing metadata and committed empty templates fail closed',async()=>{
 assert.equal(prepareAuthTest(null,null).code,'INPUT_REQUIRED');
 const target=JSON.parse(await readFile(new URL('../tools/auth-local/test-target.template.json',import.meta.url),'utf8'));
 const inventory=JSON.parse(await readFile(new URL('../tools/auth-local/test-inventory.template.json',import.meta.url),'utf8'));
 assert.equal(prepareAuthTest(target,inventory).status,'NOT_READY');
 assert.equal((await prepareFromFiles([],[])).code,'INPUT_REQUIRED');
});
test('production identities, database reuse, aliases and local D1 sentinel never produce a plan',async t=>{
 const mutations=[
  t=>t.projectId=PRODUCTION_PROJECT,
  t=>t.origin=`https://${PRODUCTION_HOST}`,
  (t,i)=>t.database.id=i.databases[0].id,
  (t,i)=>t.database.name=i.databases[0].name,
  t=>t.database.id=LOCAL_DATABASE,
  t=>t.database.name='lantern-prod-test',
  t=>t.database.name='main',
  t=>t.database.name='default'
 ];
 for(const [index,mutate] of mutations.entries())await t.test(String(index+1),()=>{const {target,inventory}=fixture();mutate(target,inventory);assert.equal(prepareAuthTest(target,inventory).status,'NOT_READY');});
});
test('test labels cannot replace account, project-to-DB, hostname and production exclusion evidence',async t=>{
 const mutations=[
  t=>t.accountId='different-account',
  (t,i)=>i.projects[1].databaseId=i.databases[0].id,
  (t,i)=>i.databases[1].projectIds=[PRODUCTION_PROJECT],
  (t,i)=>i.databases[1].projectIds.push(PRODUCTION_PROJECT),
  (t,i)=>i.projects[1].hostname='another-test.chatgpt.site',
  (t,i)=>i.projects[1].databaseBinding='OTHER',
  (t,i)=>i.projects[1].purpose='production',
  (t,i)=>i.databases[1].purpose='production',
  (t,i)=>i.projects[1].accountId='different-account',
  (t,i)=>i.projects[0].id='appgprj_d92ae4f5c63847b091fc65e7a8302b16',
  (t,i)=>i.projects[0].hostname='other-production.chatgpt.site',
  (t,i)=>i.databases[0].id=i.databases[1].id,
  (t,i)=>i.projects[1].id=i.projects[0].id,
  (t,i)=>i.evidenceRefs=[],
  (t,i)=>i.observedAt='2020-01-01T00:00:00.000Z',
  (t,i)=>i.observedAt='2099-01-01T00:00:00.000Z',
  t=>t.database.binding='BUCKET'
 ];
 for(const [index,mutate] of mutations.entries())await t.test(String(index+1),()=>{const {target,inventory}=fixture();mutate(target,inventory);assert.equal(prepareAuthTest(target,inventory).status,'NOT_READY');});
});
test('invalid or placeholder origins and IDs are rejected rather than normalized into an endpoint',async t=>{
 for(const value of ['','http://auth-test-fixture.chatgpt.site','https://localhost','https://lantern.local','https://127.0.0.1','https://[::1]','https://test.invalid','https://example.com','https://auth-test-fixture.chatgpt.site:444','https://auth-test-fixture.chatgpt.site/','https://auth-test-fixture.chatgpt.site/path','https://auth-test-fixture.chatgpt.site?token=x','https://u:p@auth-test-fixture.chatgpt.site','https://auth-test-fixture.chatgpt.site.'])await t.test(value||'empty',()=>{const {target,inventory}=fixture();target.origin=value;assert.equal(prepareAuthTest(target,inventory).status,'NOT_READY');});
 for(const value of ['','main','appgprj_00000000000000000000000000000000','replace-with-project']){const {target,inventory}=fixture();target.projectId=value;assert.equal(prepareAuthTest(target,inventory).status,'NOT_READY');}
});
test('enabling auth, real data, secrets and unrecognized fields are rejected without echoing input',()=>{
 for(const mutate of [t=>t.vars.LANTERN_AUTH_ENABLED='true',t=>t.dataPolicy='learning-data',t=>t.vars.API_TOKEN='do-not-echo-synthetic-secret',t=>t.token='do-not-echo-synthetic-secret']){
  const {target,inventory}=fixture();mutate(target);const report=prepareAuthTest(target,inventory);
  assert.equal(report.status,'NOT_READY');assert(!JSON.stringify(report).includes('do-not-echo'));
 }
});
test('environment name guards run before file reads and never inspect variable values',async()=>{
 for(const name of ['CLOUDFLARE_API_TOKEN','cloudflare_api_token','CF_API_KEY','CF_ACCOUNT_ID','CLOUDFLARE_ENV','WRANGLER_ENV','AUTH_API_ORIGIN','LANTERN_AUTH_ENABLED','LANTERN_AUTH_ORIGIN','NODE_TLS_REJECT_UNAUTHORIZED','SITES_PROJECT_ID','DATABASE_URL']){
  const env={};Object.defineProperty(env,name,{enumerable:true,get(){throw Error('must not inspect environment value');}});
  assert.equal((await prepareFromFiles(['--target','unreadable.json','--inventory','absent.json'],Object.keys(env))).code,'ENVIRONMENT_PRESENT');
 }
});
test('unsupported paths and deployment flags cannot enter a runner',async()=>{
 for(const args of [['--deploy'],['--target','a.json','--inventory','a.json'],['--target','.env','--inventory','i.json'],['--target','credential.json','--inventory','i.json'],['--target','backup.json','--inventory','i.json'],['--target','a.json','--inventory','b.json','--apply']])assert.equal((await prepareFromFiles(args,[])).status,'NOT_READY');
 const source=await readFile(new URL('../tools/auth-local/prepare.mjs',import.meta.url),'utf8');
 assert(!/from ['"]node:(?:child_process|https?|tls|net|dns)/.test(source));
 assert(!/\b(?:fetch|spawn|execFile|writeFile|mkdir|createServer)\s*\(/.test(source));
});

// Child instrumentation blocks side effects even on the successful CLI path.
const guard=`
 import fs from 'node:fs';import fsp from 'node:fs/promises';import cp from 'node:child_process';
 import net from 'node:net';import http from 'node:http';import https from 'node:https';import tls from 'node:tls';
 import {syncBuiltinESMExports} from 'node:module';
 let attempts=0;const deny=()=>{attempts++;throw Error('FORBIDDEN_SIDE_EFFECT');};
 process.on('exit',()=>{if(attempts)process.exitCode=99;});
 for(const key of ['writeFile','appendFile','mkdir','mkdtemp','rm','unlink','rename','copyFile','symlink','link','truncate','rmdir']){if(key in fsp)fsp[key]=deny;if(key in fs)fs[key]=deny;if(key+'Sync' in fs)fs[key+'Sync']=deny;}
 for(const key of ['spawn','exec','execFile','fork','spawnSync','execSync','execFileSync'])cp[key]=deny;
 for(const mod of [net,http,https,tls])for(const key of ['connect','createConnection','createServer','request','get'])if(key in mod)mod[key]=deny;
 net.Socket.prototype.connect=deny;globalThis.fetch=deny;syncBuiltinESMExports();
`;
test('actual CLI success, production failure and missing input perform no writes, network, spawn or serving',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'lantern-auth-prepare-'));
 const targetPath=path.join(directory,'target.json'),inventoryPath=path.join(directory,'inventory.json');
 t.after(async()=>{for(const item of await readdir(directory))await unlink(path.join(directory,item));await rmdir(directory);});
 const {target,inventory}=fixture();
 await writeFile(targetPath,JSON.stringify(target));await writeFile(inventoryPath,JSON.stringify(inventory));
 const run=args=>spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(guard),'scripts/auth-local.mjs','prepare',...args],{cwd:root,encoding:'utf8',windowsHide:true,env:{SystemRoot:process.env.SystemRoot||'',TEMP:tmpdir(),TMP:tmpdir()},timeout:10000});
 const args=['--target',targetPath,'--inventory',inventoryPath];
 const good=run(args);assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).status,'PLAN_ONLY');assert(!good.stderr.includes('FORBIDDEN_SIDE_EFFECT'));
 target.projectId=PRODUCTION_PROJECT;await writeFile(targetPath,JSON.stringify(target));
 const bad=run(args);assert.equal(bad.status,2,bad.stderr);assert.equal(JSON.parse(bad.stdout).code,'PRODUCTION_TARGET');
 const absent=run([]);assert.equal(absent.status,2);assert.equal(JSON.parse(absent.stdout).code,'INPUT_REQUIRED');
 const empty=run(['--target','tools/auth-local/test-target.template.json','--inventory','tools/auth-local/test-inventory.template.json']);assert.equal(empty.status,2);assert.equal(JSON.parse(empty.stdout).status,'NOT_READY');
 assert.deepEqual((await readdir(directory)).sort(),['inventory.json','target.json']);
 assert.deepEqual(JSON.parse(await readFile(targetPath,'utf8')),target);assert.deepEqual(JSON.parse(await readFile(inventoryPath,'utf8')),inventory);
});
test('shipped local and native network authentication remain disabled',async()=>{
 const local=JSON.parse(await readFile(new URL('../tools/auth-local/wrangler.json',import.meta.url),'utf8'));
 assert.equal(local.vars.LANTERN_AUTH_ENABLED,'false');assert.equal(local.d1_databases[0].database_id,LOCAL_DATABASE);
 const native=await readFile(new URL('../harmony/entry/src/main/ets/auth/AuthConfiguration.ets',import.meta.url),'utf8');
 assert.match(native,/AUTH_API_ORIGIN: string = ''/);
 const hosting=JSON.parse(await readFile(new URL('../.openai/hosting.json',import.meta.url),'utf8'));
 assert.equal(hosting.project_id,PRODUCTION_PROJECT);assert.equal(hosting.d1,'DB');
});
