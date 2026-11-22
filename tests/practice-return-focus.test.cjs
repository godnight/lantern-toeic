'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const {createPracticeReturnFocus}=createSourceLoader({root:path.resolve(__dirname,'..')}).load('app/learn/practice-return-focus.ts');
function fixture(){
 let id=0,scope=true,canFocus=true;const frames=new Map(),scrolls=[],calls=[],document={activeElement:null};
 const target={isConnected:true,disabled:false,hidden:false,aria:false,ownerDocument:document,matches:()=>target.disabled,getAttribute:name=>name==='aria-disabled'&&target.aria?'true':null,closest:()=>target.hidden?{}:null,getClientRects:()=>target.hidden?[]:[{}],focus:options=>{calls.push(options);document.activeElement=target;}};
 const control=createPracticeReturnFocus({requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:n=>frames.delete(n),scroll:top=>scrolls.push(top)});
 const request=(element=target,top=75)=>control.request({target:element,scrollTop:top,isCurrent:()=>scope,canFocus:()=>canFocus});
 const tick=()=>{const running=[...frames.values()];frames.clear();running.forEach(fn=>fn(0));};
 return {control,target,document,request,tick,frames,scrolls,calls,scope:value=>scope=value,canFocus:value=>canFocus=value};
}
test('normal return restores scroll once and focuses once',()=>{
 const f=fixture();f.request();assert.equal(f.frames.size,1);f.tick();assert.deepEqual(f.scrolls,[75]);assert.equal(f.document.activeElement,f.target);assert.equal(f.calls.length,1);assert.equal(f.calls[0].preventScroll,true);f.control.retry();f.tick();assert.deepEqual(f.scrolls,[75]);assert.equal(f.calls.length,1);
});
test('disabled, disconnected and hidden target awaits retry without repeated scrolling',()=>{
 const f=fixture();f.target.disabled=true;f.request();f.tick();assert.deepEqual(f.scrolls,[75]);assert.equal(f.calls.length,0);assert.equal(f.frames.size,0);
 f.control.retry();f.control.retry();assert.equal(f.frames.size,1);f.tick();f.target.disabled=false;f.target.isConnected=false;f.control.retry();f.tick();f.target.isConnected=true;f.target.hidden=true;f.control.retry();f.tick();assert.equal(f.calls.length,0);assert.deepEqual(f.scrolls,[75]);
 f.target.hidden=false;f.control.retry();f.tick();assert.equal(f.calls.length,1);assert.deepEqual(f.scrolls,[75]);
});
test('busy and an overlapping dialog delay focus until conditions become safe',()=>{
 const f=fixture();f.canFocus(false);f.request();f.tick();assert.deepEqual(f.scrolls,[75]);assert.equal(f.calls.length,0);f.control.retry();f.tick();assert.equal(f.calls.length,0);f.canFocus(true);f.control.retry();f.tick();assert.equal(f.calls.length,1);assert.deepEqual(f.scrolls,[75]);
});
test('owner or navigation invalidation cancels without affecting a different page',()=>{
 const f=fixture();f.request();f.scope(false);f.tick();assert.deepEqual(f.scrolls,[]);assert.equal(f.calls.length,0);f.scope(true);f.control.retry();f.tick();assert.equal(f.calls.length,0);
 f.target.disabled=true;f.request();f.tick();f.scope(false);f.target.disabled=false;f.control.retry();f.tick();assert.deepEqual(f.scrolls,[75]);assert.equal(f.calls.length,0);f.scope(true);f.control.retry();f.tick();assert.equal(f.calls.length,0);
});
test('user interaction or unmount cancels pending work and stale scheduled frames',()=>{
 for(const beforeFrame of [true,false]){const f=fixture();f.target.disabled=true;f.request();if(!beforeFrame)f.tick();f.control.cancel();f.target.disabled=false;f.control.retry();f.tick();assert.equal(f.calls.length,0);assert.deepEqual(f.scrolls,beforeFrame?[]:[75]);}
});
test('new request supersedes an older one and has its own scroll target',()=>{
 const f=fixture();f.target.disabled=true;f.request(f.target,25);f.tick();f.target.disabled=false;f.request(f.target,90);f.tick();assert.deepEqual(f.scrolls,[25,90]);assert.equal(f.calls.length,1);
});
test('a missing return target restores scroll without leaving work scheduled',()=>{
 const f=fixture();f.request(null,30);f.tick();assert.deepEqual(f.scrolls,[30]);assert.equal(f.calls.length,0);f.control.retry();assert.equal(f.frames.size,0);
});

test('scroll waits for the original page to be visible, then runs before busy clears',()=>{
 const f=fixture();let pageVisible=false;f.target.disabled=true;
 f.control.request({target:f.target,scrollTop:82,isCurrent:()=>true,canFocus:()=>true,canScroll:()=>pageVisible});f.tick();assert.deepEqual(f.scrolls,[]);assert.equal(f.calls.length,0);
 f.control.retry();f.tick();assert.deepEqual(f.scrolls,[]);pageVisible=true;f.control.retry();f.tick();assert.deepEqual(f.scrolls,[82]);assert.equal(f.calls.length,0);
 f.target.disabled=false;f.control.retry();f.tick();assert.deepEqual(f.scrolls,[82]);assert.equal(f.calls.length,1);
});
