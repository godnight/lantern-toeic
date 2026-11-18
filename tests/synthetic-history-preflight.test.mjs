import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=process.cwd();
const {SyntheticHistoryFixture,inspectSyntheticHistory}=createSourceLoader({root}).load('lib/cloud-sync/synthetic-history-preflight.ts');
const owner='usr_aaaaaaaa-1111-4111-8111-111111111111',other='usr_bbbbbbbb-1111-4111-8111-111111111111';
const key='lantern-v1-'+owner,at='2026-10-14T10:00:00.000Z';
const attempt=(id,changes={})=>({id,qid:'synthetic-question',choice:1,correct:true,createdAt:at,seconds:3,mode:'first',...changes});
const checkin=id=>({id,date:'2026-10-14',minutes:5,load:'轻',note:'fixture',createdAt:at});
const data=(changes={})=>({schemaVersion:2,profile:{name:'fixture'},attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[],...changes});
const checkpoint=(changes={})=>JSON.stringify({kind:'lantern-study-checkpoint',version:1,owner,data:data(changes)});
const lease=()=>({owner,generation:1,active:true});
const plain=value=>JSON.parse(JSON.stringify(value));
const a=attempt('attempt-a'),b=attempt('attempt-b',{mode:'review'}),c=checkin('checkin-c');

test('inventory includes primary, checkpoints and loose events without touching another account or source bytes',()=>{
 const foreignKey='lantern-v1-'+other;
 const source=new SyntheticHistoryFixture([
  [key,JSON.stringify({data:data({attempts:[a],checkins:[c]})})],
  [key+':checkpoint:segment',checkpoint({attempts:[a,b]})],
  [key+':checkpoint-epoch','v1'],
  [key+':op:operation-c',JSON.stringify({id:'operation-c',owner,type:'checkin',data:c})],
  [key+':ack:operation-c','1'],
  [key+':profile',JSON.stringify({name:'fixture profile'})],
  [key+':recording:recording-a',JSON.stringify({id:'recording-a',title:'fixture'})],
  [foreignKey,'foreign bytes must never be read']
 ]);
 const before=plain(source.bytes()),reads=[];source.onRead=name=>reads.push(name);
 const result=plain(inspectSyntheticHistory(source,lease()));
 assert.equal(result.ready,false);assert.equal(result.requiresExclusiveLease,true);
 assert.equal(result.checkpoints,1);assert.equal(result.operations,1);
 assert.deepEqual(result.events.map(event=>event.id).sort(),['attempt-a','attempt-b','checkin-c']);
 assert.equal(result.events.find(event=>event.id==='attempt-a').sources.length,2);
 assert(result.unsupported.includes('recording metadata and audio'));
 assert(result.unsupported.includes('profile and settings'));
 assert(result.unsupported.includes('prior acknowledgements'));
 assert(!result.sourceBytes.some(([name])=>name===foreignKey));
 assert(!reads.includes(foreignKey));assert.deepEqual(plain(source.bytes()),before);
});

test('a compaction across the scan retries and sees the event in its new checkpoint',()=>{
 const op=JSON.stringify({id:'op-a',owner,type:'attempt',data:a});
 const source=new SyntheticHistoryFixture([[key,JSON.stringify({data:data()})],[key+':op:op-a',op],[key+':checkpoint-epoch','old']]);
 let moved=false;source.onRead=name=>{if(name===key&&!moved){moved=true;source.set(key+':checkpoint:new',checkpoint({attempts:[a]}));source.set(key+':checkpoint-epoch','new');source.delete(key+':op:op-a');}};
 const result=plain(inspectSyntheticHistory(source,lease()));
 assert.equal(result.checkpoints,1);assert.deepEqual(result.events.map(event=>event.id),['attempt-a']);
 assert(result.sourceBytes.some(([name])=>name===key+':checkpoint:new'));
});

test('continuous compaction or primary snapshot changes fail closed',()=>{
 const source=new SyntheticHistoryFixture([[key,JSON.stringify({data:data()})],[key+':checkpoint-epoch','0']]);let n=0;
 source.onRead=name=>{if(name===key+':checkpoint-epoch')source.set(name,String(++n));};
 assert.throws(()=>inspectSyntheticHistory(source,lease()),/history changed/);
 const changing=new SyntheticHistoryFixture([[key,JSON.stringify({data:data()})]]);let x=0;
 changing.onRead=name=>{if(name===key)changing.set(key,JSON.stringify({data:data(),revision:++x}));};
 assert.throws(()=>inspectSyntheticHistory(changing,lease()),/history changed/);
});

test('account lease changes and foreign ownership abort the entire inventory',()=>{
 const source=new SyntheticHistoryFixture([[key,JSON.stringify({data:data()})]]),active=lease();
 source.onRead=name=>{if(name===key)active.generation++;};
 assert.throws(()=>inspectSyntheticHistory(source,active),/account lease changed/);
 const foreignCheckpoint=JSON.stringify({kind:'lantern-study-checkpoint',version:1,owner:other,data:data()});
 assert.throws(()=>inspectSyntheticHistory(new SyntheticHistoryFixture([[key+':checkpoint:a',foreignCheckpoint]]),lease()),/checkpoint owner/);
 const foreignOp=JSON.stringify({id:'op',owner:other,type:'attempt',data:a});
 assert.throws(()=>inspectSyntheticHistory(new SyntheticHistoryFixture([[key+':op:op',foreignOp]]),lease()),/operation owner/);
});

test('conflicts, damaged records and future versions fail without altering their bytes',()=>{
 const fixtures=[
  [[key,JSON.stringify({data:data({attempts:[a]})})],[key+':checkpoint:c',checkpoint({attempts:[{...a,mode:'review'}]})]],
  [[key,JSON.stringify({data:data({attempts:[{...a,choice:8}]})})]],
  [[key+':checkpoint:c',checkpoint({checkins:[null]})]],
  [[key,JSON.stringify({data:{...data(),schemaVersion:3}})]],
  [[key+':required-schema',JSON.stringify({schemaVersion:3})]],
  [[key+':op:op',JSON.stringify({id:'op',owner,type:'future-operation',data:{}})]],
  [[key+':recording:one',JSON.stringify({id:'different'})]],
  [[key+':ack:op','not-an-ack']]
 ];
 for(const entries of fixtures){const source=new SyntheticHistoryFixture(entries),before=plain(source.bytes());assert.throws(()=>inspectSyntheticHistory(source,lease()));assert.deepEqual(plain(source.bytes()),before);}
});

test('legacy schema is inventoried but never declared migration-ready',()=>{
 const old={schemaVersion:1,attempts:[a],checkins:[c],recordings:[]};
 const result=plain(inspectSyntheticHistory(new SyntheticHistoryFixture([[key,JSON.stringify({data:old})]]),lease()));
 assert.equal(result.ready,false);assert.equal(result.events.length,2);
 assert(result.unsupported.includes('old history migration'));
 assert.throws(()=>inspectSyntheticHistory({keys(){return [];},get(){return null;}},lease()),/synthetic fixture/);
});

test('unknown envelope and prior sync metadata remain in the inventory and block readiness',()=>{
 const snapshot=JSON.stringify({data:data({attempts:[a]}),studySync:{checkpoint:'fixture'},futureField:{value:1}});
 const source=new SyntheticHistoryFixture([[key,snapshot],[key+':unknown-field','not json']]);
 const result=plain(inspectSyntheticHistory(source,lease()));
 assert.equal(result.ready,false);assert(result.unsupported.includes('account ownership proof'));
 assert(result.unsupported.includes('prior sync state'));assert(result.unsupported.includes('unknown snapshot envelope fields'));
 assert(result.unsupported.includes('unknown local history fields'));
 assert.equal(result.sourceBytes.find(([name])=>name===key)[1],snapshot);
});
