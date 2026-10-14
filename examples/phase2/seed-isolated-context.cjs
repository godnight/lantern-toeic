/* SYNTHETIC QA helper. Does not launch a browser or seed anything when required. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DIR=__dirname,MARKER='synthetic-phase2-qa-seed-v1';
function checkedBytes(relative){
 const manifest=JSON.parse(fs.readFileSync(path.join(DIR,'MANIFEST.json'),'utf8'));
 const entry=manifest.files.find(row=>row.path===relative);if(!entry)throw Error('Fixture is absent from manifest');
 const bytes=fs.readFileSync(path.join(DIR,relative));if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Fixture hash mismatch: '+relative);
 return bytes;
}
const checkedFile=relative=>JSON.parse(checkedBytes(relative));
function syntheticSeed({scenario,mode='legacy-only',fault}){
 const index=checkedFile('FIXTURE-INDEX.json'),item=index.scopes.find(row=>row.name===scenario);if(!item)throw Error('Unknown synthetic scope');
 if(!['legacy-only','matching-workflow','missing-references'].includes(mode))throw Error('Unknown fixture mode');
 const old=checkedFile(item.prefix+'legacy-study-snapshot.json');
 const study=mode==='matching-workflow'?checkedFile(item.prefix+'workflow-study-snapshot.json').data:old.data;
 const vocab=checkedFile(item.prefix+(mode==='matching-workflow'?'workflow-vocabulary-backup.json':'legacy-vocabulary-backup.json'));
 let snapshot=JSON.stringify({data:study}),vocabulary=JSON.stringify(vocab);
 if(mode==='missing-references'){const empty={...old.data,attempts:[],checkins:[],recordings:[]};snapshot=JSON.stringify({data:empty});vocabulary=JSON.stringify({kind:'lantern-vocabulary',schemaVersion:1,events:[]});}
 if(fault){
  if(scenario!=='web-local'||mode!=='legacy-only')throw Error('Fault samples require a separate web-local legacy-only context');
  if(fault==='bad-main')snapshot=checkedBytes('faults/bad-main-snapshot.txt').toString('utf8');
  else if(fault==='future-study')snapshot=JSON.stringify(checkedFile('faults/future-study-schema.json'));
  else throw Error('Unknown fault sample');
 }
 return {synthetic:true,scenario,mode,fault:fault||null,scope:item.scope,workflowPath:path.join(DIR,item.prefix+'workflow.json'),entries:[[item.keys.study,snapshot],[item.keys.vocabulary,vocabulary]]};
}
/** Call only with a newly created, dedicated BrowserContext before its first navigation.
 * Real UI workflow/word-card imports remain file-picker actions and are not done here. */
async function installSyntheticSeed(context,options){
 const url=new URL(options.origin);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||!url.port||url.origin!==options.origin)throw Error('An explicit isolated loopback origin with a dedicated port is required');
 const payload=syntheticSeed(options);
 await context.addInitScript(({origin,payload,marker})=>{
  if(location.origin!==origin)return;
  const identity=JSON.stringify({synthetic:true,scenario:payload.scenario,mode:payload.mode,fault:payload.fault});
  const prior=localStorage.getItem(marker);
  if(prior!==null){if(prior!==identity)throw Error('Synthetic context already belongs to another fixture');return;}
  if(localStorage.length!==0)throw Error('Refusing to overwrite nonempty origin storage; create a NEW context');
  for(const [key,value]of payload.entries){if(localStorage.getItem(key)!==null)throw Error('Refusing to overwrite '+key);localStorage.setItem(key,value);}
  localStorage.setItem(marker,identity);
 },{origin:url.origin,payload,marker:MARKER});
 return payload;
}
module.exports={syntheticSeed,installSyntheticSeed};
