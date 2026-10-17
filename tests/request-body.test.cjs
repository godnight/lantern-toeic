const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const exportsFromSource={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/request-body.ts'),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:exportsFromSource,Error,RangeError,ArrayBuffer,Uint8Array,Number,Promise});
const {readBoundedRequestBody}=exportsFromSource;
const bytes=text=>new TextEncoder().encode(text);
function request(chunks,{failAt,cleanup='normal'}={}){
 let index=0,reads=0,cancels=0;
 const stream=new ReadableStream({
  pull(controller){reads++;if(index===failAt){controller.error(Error('synthetic read failure'));return;}
   if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close();},
  cancel(){cancels++;if(cleanup==='reject')return Promise.reject(Error('synthetic cancel failure'));
   if(cleanup==='never')return new Promise(()=>{});},
 },{highWaterMark:0});
 return {request:{body:stream},stream,stats:()=>({reads,cancels,index})};
}

test('bounded body accepts exact byte boundaries and preserves UTF-8 split across chunks',async()=>{
 for(const text of ['','a','12345','中🙂']){
  const input=bytes(text),h=request([new Uint8Array(0),...[...input].map(value=>new Uint8Array([value])),new Uint8Array(0)]);
  const result=await readBoundedRequestBody(h.request,input.length);
  assert.deepEqual(new Uint8Array(result),input);assert.equal(new TextDecoder().decode(result),text);
  assert.equal(h.stream.locked,false);assert.equal(h.stats().cancels,0);
 }
 assert.equal((await readBoundedRequestBody({body:null},0)).byteLength,0);
});

test('overflow cancels at the first excess chunk without asking for later chunks',async()=>{
 const h=request([bytes('12'),bytes('345'),bytes('must not read')]);
 await assert.rejects(readBoundedRequestBody(h.request,4),error=>error.name==='RequestBodyTooLargeError');
 assert.deepEqual(h.stats(),{reads:2,cancels:1,index:2});assert.equal(h.stream.locked,false);
});

for(const cleanup of ['reject','never'])test('overflow remains promptly rejected when cancel is '+cleanup,async()=>{
 const h=request([bytes('over limit'),bytes('must not read')],{cleanup});
 let timer;
 try{
  await Promise.race([
   assert.rejects(readBoundedRequestBody(h.request,1),error=>error.name==='RequestBodyTooLargeError'),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Body limit waited for cleanup')),1000);}),
  ]);
 }finally{clearTimeout(timer);}
 assert.equal(h.stats().cancels,1);assert.equal(h.stats().reads,1);assert.equal(h.stream.locked,false);
});

for(const failAt of [0,1])test('read failure '+failAt+' rejects without returning a partial body and releases the lock',async()=>{
 const h=request([bytes('partial'),bytes('not delivered')],{failAt});
 await assert.rejects(readBoundedRequestBody(h.request,100),error=>error.name==='RequestBodyReadError');
 assert.equal(h.stream.locked,false);assert.equal(h.stats().index,failAt);
});

test('a locked or non-byte request body fails closed without consuming another readers lock',async()=>{
 const h=request([bytes('unchanged')]),reader=h.stream.getReader();
 await assert.rejects(readBoundedRequestBody(h.request,100),error=>error.name==='RequestBodyReadError');
 assert.equal(h.stream.locked,true);assert.equal(h.stats().reads,0);reader.releaseLock();
 const bad=request(['not byte chunks']);
 await assert.rejects(readBoundedRequestBody(bad.request,100),error=>error.name==='RequestBodyReadError');
 assert.equal(bad.stream.locked,false);
});

test('retained bytes cannot be changed by a producer reusing its Buffer for the next chunk',async()=>{
 const shared=Buffer.from('ab');let count=0;
 const stream=new ReadableStream({pull(controller){
  if(count++===0)controller.enqueue(shared);
  else if(count===2){shared.write('cd');controller.enqueue(shared);}else controller.close();
 }},{highWaterMark:0});
 assert.equal(Buffer.from(await readBoundedRequestBody({body:stream},4)).toString(),'abcd');
 assert.equal(stream.locked,false);
});
