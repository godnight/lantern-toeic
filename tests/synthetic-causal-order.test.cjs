'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Module,createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'package.json'));
const built=req('esbuild').buildSync({entryPoints:[path.join(root,'lib/cloud-sync/synthetic-causal-order.js')],bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'synthetic-causal-order-test-bundle.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(built.outputFiles[0].text,file);
const {projectSyntheticCausalOrder:project}=mod.exports;
const owner='usr_00000000-0000-4000-8000-000000000001',other='usr_00000000-0000-4000-8000-000000000002';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const event=(n,qid='question-1')=>({id:id(n),owner,qid});
const edge=(a,b)=>({before:id(a),after:id(b)});
const input=(events,verifiedEdges=[])=>({version:'synthetic-causal-order-v1',owner,events,verifiedEdges});
const statuses=x=>Object.fromEntries(project(x).labels.map(({id,status})=>[id,status]));

test('only a preverified predecessor can establish review; an isolated event remains unknown',()=>{
 const data=input([event(2),event(1),event(3)],[edge(1,2)]),snapshot=structuredClone(data);
 assert.deepEqual(statuses(data),{[id(1)]:'unknown',[id(2)]:'review',[id(3)]:'unknown'});
 assert.deepEqual(data,snapshot);
 assert.deepEqual(project(data),project(input([...data.events].reverse(),[...data.verifiedEdges].reverse())));
});
test('unresolved endpoints never establish review; evidence can be reevaluated when the missing event arrives',()=>{
 const incomplete=input([event(2)],[edge(1,2)]);
 assert.equal(statuses(incomplete)[id(2)],'unknown');
 assert.equal(statuses(input([event(2),event(1)],[edge(1,2)]))[id(2)],'review');
 assert.equal(statuses(input([event(1)],[edge(1,2)]))[id(1)],'unknown');
});
test('duplicates do not alter results and cycles fail closed rather than inventing an order',()=>{
 const one=input([event(1),event(2)],[edge(1,2)]),duplicates=input([event(2),event(1),event(1)],[edge(1,2),edge(1,2)]);
 assert.deepEqual(project(one),project(duplicates));
 assert.throws(()=>project(input([event(1),event(2)],[edge(1,2),edge(2,1)])),/invalid synthetic causal evidence/);
 assert.throws(()=>project(input([event(1)],[edge(1,1)])),/invalid synthetic causal evidence/);
});
test('owner, question identity, protocol and exact shape are enforced',()=>{
 for(const bad of [
  input([{...event(1),owner:other}]),input([event(1,'one'),event(1,'two')]),
  input([event(1,'one'),event(2,'two')],[edge(1,2)]),
  {...input([]),version:'native-m2a-v1'},input([{...event(1),createdAt:'2026-01-01',mode:'first'}]),
  input([{...event(1),id:id(1).toUpperCase().replace('00000000','AAAAAAAA')}]),
  input([event(1)],[{...edge(1,2),deviceClaim:'proof'}]),
 ])assert.throws(()=>project(bad),/invalid synthetic causal evidence/);
});
test('a long proven chain is processed iteratively and never infers first',()=>{
 const events=Array.from({length:10000},(_,i)=>event(i+1)),edges=Array.from({length:9999},(_,i)=>edge(i+1,i+2));
 const labels=project(input(events,edges)).labels;
 assert.equal(labels.length,10000);assert.equal(labels.filter(x=>x.status==='unknown').length,1);
 assert.equal(labels.filter(x=>x.status==='review').length,9999);
});
