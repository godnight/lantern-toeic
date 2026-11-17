const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exportsRange={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../entry/src/main/ets/services/AssetRange.ets'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsRange,ArrayBuffer,Uint8Array});
const range=exportsRange.assetBytes,bytes=Uint8Array.from({length:16},(_,i)=>i);
test('actual range bodies honor inclusive bounds, open end, suffix and clipped end',()=>{
 for(const [header,start,end] of [['bytes=3-7',3,7],['bytes=9-',9,15],['bytes=-4',12,15],['bytes=12-99',12,15],['bytes=-99',0,15]]){
  const response=range(bytes,header);assert.equal(response.code,206);assert.equal(response.length,end-start+1);assert.equal(response.contentRange,`bytes ${start}-${end}/16`);assert.deepEqual([...new Uint8Array(response.body)],[...bytes.slice(start,end+1)]);
 }
});
test('nonzero raw-resource byteOffset cannot leak adjacent backing bytes',()=>{
 const view=bytes.subarray(4,12),response=range(view,'bytes=2-4');assert.deepEqual([...new Uint8Array(response.body)],[6,7,8]);assert.equal(response.total,8);assert.equal(response.length,3);
});
test('unsatisfiable ranges have no body; unsupported ranges return a complete 200',()=>{
 for(const header of ['bytes=16-','bytes=5-2','bytes=-0','bytes=99999999999999999999-']){const response=range(bytes,header);assert.equal(response.code,416,header);assert.equal(response.body.byteLength,0);assert.equal(response.length,0);assert.equal(response.contentRange,'bytes */16');}
 for(const header of ['','items=2-4','bytes=0-1,4-6','bytes=wrong']){const response=range(bytes,header);assert.equal(response.code,200);assert.equal(response.contentRange,'');assert.deepEqual([...new Uint8Array(response.body)],[...bytes]);}
});
test('HEAD ignores ranges, has no body and retains the full representation length',()=>{
 const response=range(bytes,'bytes=3-7',true);assert.equal(response.code,200);assert.equal(response.body.byteLength,0);assert.equal(response.length,16);assert.equal(response.contentRange,'');
});
test('the real shipped main track returns exactly the requested bytes',()=>{
 const file=path.join(__dirname,'../../mobile/offline-audio/mp3/1935c17708c726884ac9.mp3');
 const raw=fs.readFileSync(file),response=range(raw,'bytes=262144-');assert.equal(response.code,206);assert.ok(response.body.byteLength<raw.byteLength);assert.deepEqual(Buffer.from(response.body),raw.subarray(262144));
});

function nativeHost(){
 const raw=fs.readFileSync(path.join(__dirname,'../entry/src/main/ets/pages/Index.ets'),'utf8'),prelude=raw.slice(raw.indexOf('const APP_ORIGIN'),raw.indexOf('@Entry'));
 const methods=raw.slice(raw.indexOf('  private errorResponse('),raw.indexOf('  private denyPendingMicrophone('));
 class Response{setResponseData(v){this.body=v;}setResponseCode(v){this.code=v;}setReasonMessage(v){this.reason=v;}setResponseMimeType(v){this.mime=v;}setResponseEncoding(v){this.encoding=v;}setResponseHeader(v){this.headers=v;}setResponseIsReady(v){this.ready=v;}}
 const manager={resourceManager:{getRawFileContentSync:name=>bytes.subarray(2,14),getRawFileContent:async name=>{if(name.endsWith('missing.mp3'))throw Error('missing');return bytes.subarray(2,14);}}},out={};
 const code=ts.transpileModule(prelude+'\nclass Host {context(){return manager;}'+methods+'}\nexports.Host=Host;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports:out,manager,assetBytes:range,WebResourceResponse:Response,Uint8Array,ArrayBuffer,console:{info(){}}});
 return new out.Host();
}
const request=(headers=[],method='GET',url='https://lantern.local/audio/test.mp3')=>({getRequestUrl:()=>url,getRequestMethod:()=>method,getRequestHeader:()=>headers});
const settle=()=>new Promise(setImmediate);
test('actual Index intercept reads case-insensitive Range and returns sliced bytes and matching headers',async()=>{
 const host=nativeHost(),response=host.intercept(request([{headerKey:'rAnGe',headerValue:'bytes=3-6'}]));assert.equal(response.ready,false);await settle();assert.equal(response.ready,true);assert.equal(response.code,206);assert.equal(response.mime,'audio/mpeg');assert.deepEqual([...new Uint8Array(response.body)],[5,6,7,8]);const headers=Object.fromEntries(response.headers.map(h=>[h.headerKey,h.headerValue]));assert.equal(headers['Content-Length'],'4');assert.equal(headers['Content-Range'],'bytes 3-6/12');assert.equal(headers['Accept-Ranges'],'bytes');
});
test('actual native HEAD, If-Range, duplicate Range, missing asset and method gates terminate safely',async()=>{
 for(const [headers,method,code,bodyLength] of [[[{headerKey:'Range',headerValue:'bytes=2-4'}],'HEAD',200,0],[[{headerKey:'Range',headerValue:'bytes=2-4'},{headerKey:'If-Range',headerValue:'unknown'}],'GET',200,12],[[{headerKey:'Range',headerValue:'bytes=2-4'},{headerKey:'range',headerValue:'bytes=8-9'}],'GET',200,12],[[{headerKey:'Range',headerValue:'bytes=99-'}],'GET',416,0]]){
  const response=nativeHost().intercept(request(headers,method));await settle();assert.equal(response.code,code);assert.equal(response.body.byteLength,bodyLength);assert.equal(response.ready,true);
 }
 const missing=nativeHost().intercept(request([],'GET','https://lantern.local/missing.mp3'));await settle();assert.equal(missing.code,404);assert.equal(missing.ready,true);
 const denied=nativeHost().intercept(request([],'POST'));assert.equal(denied.code,405);assert.equal(denied.headers[0].headerValue,'GET, HEAD');
 assert.equal(nativeHost().intercept(request([],'GET','https://external.invalid/file')),null);
});

test('packaged media status, headers and actual body are ready before interception returns',()=>{
 const response=nativeHost().intercept(request([{headerKey:'Range',headerValue:'bytes=3-6'}],'GET','https://lantern.local/audio/offline/1935c17708c726884ac9.mp3'));
 assert.equal(response.ready,true);assert.equal(response.code,206);assert.deepEqual([...new Uint8Array(response.body)],[5,6,7,8]);assert.equal(response.headers.find(h=>h.headerKey==='Content-Range').headerValue,'bytes 3-6/12');
});
