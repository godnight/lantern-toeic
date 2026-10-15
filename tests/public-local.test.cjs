const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'),ts=require(path.join(root,'node_modules/typescript'));
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});return exports;}
const boundary=load('lib/account-boundary.ts');
test('identity capability remains unknown until readable and never turns native owner into a product session',()=>{
 assert.equal(boundary.identityView(false,'alice',false,7).status,'unknown');
 assert.equal(boundary.identityView(true,'alice',true,8).status,'guest');
 const legacy=boundary.identityView(true,'owner-opaque-123',false,9);assert.equal(legacy.status,'legacy-session');assert.equal(legacy.maskedLabel,'ow…23');assert.equal(legacy.generation,9);
 assert.equal(Object.values(boundary.ACCOUNT_CAPABILITIES).some(Boolean),false);assert.equal(boundary.MIGRATION_CONTRACT.writesEnabled,false);
});
test('recovery actions distinguish authentication, permission, identity and event payload conflict',()=>{
 for(const [httpStatus,kind] of [[401,'login'],[403,'permission'],[409,'identity'],[422,'conflict'],[0,'retry'],[503,'retry']])assert.equal(boundary.syncRecovery({httpStatus}).kind,kind);
 assert.equal(boundary.syncRecovery({status:'auth'}).kind,'identity');assert.equal(boundary.syncRecovery({status:'missing',httpStatus:0}).kind,'retry');
});
test('public gate fails closed for pending rights and an unreviewed generated artifact',()=>{
 const run=spawnSync(process.execPath,[path.join(root,'scripts/check-public-distribution.mjs'),'--target','web','--artifact-root',path.join(root,'public/project-information')],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,1,run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.eligible,false);assert.ok(result.issues.some(issue=>issue.startsWith('themes:')));assert.ok(result.issues.some(issue=>issue.includes('No reviewed file allowlist entry')));assert.ok(result.checkedFiles>=3);
});
