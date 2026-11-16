import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHttpsHandler} from './https-handler.candidate.mjs';
import {createLocalChannel} from './local-channel.candidate.mjs';

// Synthetic in-process HTTPS ingress shape; no listener, credentials, or external I/O.
test('the explicit session capability survives both gateway allowlists and duplicate raw headers are rejected',async()=>{
 const origin='https://synthetic.invalid',received=[];
 const channel=createLocalChannel({enabled:true,origin,assembly:{async fetch(request){received.push(request.headers.get('x-lantern-session-policy'));return Response.json({ok:true});}}});
 const handler=createHttpsHandler({origin,channel});
 async function call(values){
  const req=Readable.from([]),raw=['Host','synthetic.invalid','Origin',origin];
  for(const value of values)raw.push('X-Lantern-Session-Policy',value);
  Object.assign(req,{rawHeaders:raw,headers:{host:'synthetic.invalid',origin,...(values.length?{'x-lantern-session-policy':values.join(', ')}:{})},method:'POST',url:'/api/auth/login',socket:{servername:'synthetic.invalid'}});
  let status;const res={headersSent:false,destroyed:false,writeHead(code){status=code;this.headersSent=true;},end(){},destroy(){this.destroyed=true;}};
  await handler(req,res);return status;
 }
 try{
  assert.equal(await call([]),200);assert.equal(received.at(-1),null);
  assert.equal(await call(['persistent-v1']),200);assert.equal(received.at(-1),'persistent-v1');
  const count=received.length;assert.equal(await call(['persistent-v1','persistent-v1']),400);assert.equal(received.length,count);
 }finally{await channel.close();}
});
