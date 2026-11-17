const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate,createHash } = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const { Miniflare, Log, LogLevel } = require(path.join(root, 'node_modules/miniflare'));
// Optional diagnostics are opt-in. No implicit QA certificate/key or old dist.
const certPath = process.env.LANTERN_FRAMING_TLS_CERT ? path.resolve(process.env.LANTERN_FRAMING_TLS_CERT) : null;
const keyPath = process.env.LANTERN_FRAMING_TLS_KEY ? path.resolve(process.env.LANTERN_FRAMING_TLS_KEY) : null;
const frozen = process.env.LANTERN_FRAMING_FROZEN_ROOT ? path.resolve(process.env.LANTERN_FRAMING_FROZEN_ROOT) : null;
const frozenIssue = !frozen
  ? 'NOT_RUN: LANTERN_FRAMING_FROZEN_ROOT is not explicitly configured'
  : fs.existsSync(path.join(frozen,'dist/server/index.js')) && fs.existsSync(path.join(frozen,'dist/client'))
    ? false : 'NOT_RUN: explicit optional frozen whole-app dist fixture is absent';
const tlsIssue = (()=>{
  if(!certPath||!keyPath)return 'NOT_RUN: LANTERN_FRAMING_TLS_CERT and LANTERN_FRAMING_TLS_KEY are not explicitly configured';
  if(!fs.existsSync(certPath)||!fs.existsSync(keyPath))return 'NOT_RUN: explicit optional TLS fixtures are absent';
  try{
    const cert=new X509Certificate(fs.readFileSync(certPath));
    if(!cert.checkIP('127.0.0.1')||Date.now()<Date.parse(cert.validFrom)||Date.now()>Date.parse(cert.validTo))return 'NOT_RUN: fixture certificate lacks valid loopback identity/date';
    return false;
  }catch{return 'NOT_RUN: fixture certificate is invalid';}
})();

// Transport diagnostics only. HTTP uses isolated random loopback ports and no
// browser, TLS settings, external credentials or QA-owned running instance.
// The negative controls below PASS when the pinned local TLS defect is
// reproduced. This is deliberately not a browser/product acceptance test.
const script = `export default { async fetch(request) {
  const route = new URL(request.url).pathname;
  if (route === '/read') await request.arrayBuffer();
  if (route === '/cancel' && request.body) await request.body.cancel();
  return Response.json({ok:true});
}};`;

function nodeRequest(origin, route, body = '{}', options = {}) {
  return new Promise((resolve, reject) => {
    const secure = origin.startsWith('https:');
    const req = (secure ? https : http).request(origin + route, {
      method: options.method || 'POST', agent: false,
      ...(secure ? {ca:fs.readFileSync(certPath),rejectUnauthorized:true} : {}),
      headers: { 'Content-Type': 'application/json', ...(body === null ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...options.headers },
    }, (res) => {
      const chunks = []; let done = false;
      const finish = (error) => {
        if (done) return; done = true;
        resolve({status:res.statusCode, headers:res.headers, contentLength:res.headers['content-length'], complete:res.complete,
          body:Buffer.concat(chunks).toString(), error:error ? String(error) : null});
      };
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => finish()); res.on('aborted', () => finish(new Error('response aborted')));
      res.on('error', finish); res.on('close', () => { if (!res.complete) finish(new Error('incomplete close')); });
    });
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.end(body === null ? undefined : body);
  });
}

function wireRequest(origin, route, body = '{}', options = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const connected = () => {
      const headers = {'Content-Type':'application/json',...(body === null ? {} : {'Content-Length':Buffer.byteLength(body)}),...options.headers};
      socket.write(`${options.method || 'POST'} ${route} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n${Object.entries(headers).map(([name,value])=>name+': '+value).join('\r\n')}\r\n\r\n${body === null ? '' : body}`);
    };
    const socket = url.protocol === 'https:'
      ? tls.connect({host:url.hostname,port:Number(url.port),ca:fs.readFileSync(certPath),rejectUnauthorized:true},connected)
      : net.createConnection({host:url.hostname,port:Number(url.port)},connected);
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('error', reject); socket.setTimeout(10000, () => socket.destroy(new Error('timeout')));
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString(); const boundary = raw.indexOf('\r\n\r\n');
      const head = raw.slice(0,boundary), responseBody = raw.slice(boundary+4);
      resolve({status:Number(head.match(/^HTTP\/1\.1 (\d+)/)?.[1]),head, body:responseBody, bodyBytes:Buffer.byteLength(responseBody), rawBytes:Buffer.byteLength(raw)});
    });
  });
}

const publicNode = ({headers, ...result}) => result;
const publicWire = result => ({...result,head:result.head.replace(/^(set-cookie:\s*)[^;\r\n]*/gim,'$1[redacted]')});
function framing(node,wire,complete) {
  assert.equal(node.complete,complete);
  if(complete){assert.equal(Buffer.byteLength(node.body),Number(node.contentLength));assert.equal(wire.bodyBytes,Number(node.contentLength));}
  else {assert.equal(node.body,'');assert.equal(wire.bodyBytes,0);}
}
async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port;
}

test('diagnose unread-body behavior through real Miniflare HTTP listener and raw wire', {timeout:60000}, async t => {
  const mf = new Miniflare({name:'lantern-framing-core-diagnostic',modules:true,script,
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,
    host:'127.0.0.1',port:0, log:new Log(LogLevel.ERROR),
    outboundService:()=>new Response('External requests disabled',{status:502})});
  t.after(() => mf.dispose()); const origin = (await mf.ready).origin;
  for (const route of ['/unread','/read','/cancel']) {
    const node = await nodeRequest(origin, route); const wire = await wireRequest(origin, route);
    t.diagnostic(JSON.stringify({scope:'transport core control',route,node:publicNode(node),wire:publicWire(wire)}));
    assert.equal(node.status,200);
    framing(node,wire,true);assert.equal(node.body,'{"ok":true}');assert.equal(wire.body,'{"ok":true}');
  }
});

test('diagnose HTTPS transport with explicit fixture trust and no system trust changes', {timeout:60000,skip:tlsIssue}, async t => {
  const mf = new Miniflare({name:'lantern-framing-core-https-diagnostic',modules:true,script,
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,
    host:'127.0.0.1',port:0,https:true,httpsCertPath:certPath,httpsKeyPath:keyPath,
    log:new Log(LogLevel.ERROR),outboundService:()=>new Response('External requests disabled',{status:502})});
  t.after(() => mf.dispose()); const origin = (await mf.ready).origin;
  for (const route of ['/unread','/read','/cancel']) {
    const node = await nodeRequest(origin, route); const wire = await wireRequest(origin, route);
    t.diagnostic(JSON.stringify({scope:'HTTPS core control; explicit QA fixture CA, hostname+chain validated',route,node:publicNode(node),wire:publicWire(wire)}));
    assert.equal(node.status,200);
    framing(node,wire,route==='/read');
    if (route === '/read') { assert.equal(node.complete,true); assert.equal(node.body,'{"ok":true}'); assert.equal(wire.body,'{"ok":true}'); }
  }
});

test('frozen full application early rejection over independent HTTP transport', {timeout:60000,skip:frozenIssue}, async t => {
  // Read only the exact old build. Never connect to QA's retained process.
  const mf = new Miniflare({name:'lantern-framing-frozen-app-diagnostic',modules:true,
    scriptPath:path.join(frozen,'dist/server/index.js'),modulesRoot:path.join(frozen,'dist/server'),
    modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs']}],
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,
    host:'127.0.0.1',port:0,
    assets:{directory:path.join(frozen,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
    d1Databases:{DB:'lantern-framing-independent-memory'},d1Persist:false,
    bindings:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:'https://study.test'},
    outboundService:()=>new Response('External requests disabled',{status:502}),log:new Log(LogLevel.ERROR)});
  t.after(() => mf.dispose()); const origin = (await mf.ready).origin;
  const node = await nodeRequest(origin,'/api/auth/logout'); const wire = await wireRequest(origin,'/api/auth/logout');
  t.diagnostic(JSON.stringify({scope:'frozen app HTTP intentionally rejected for configured HTTPS origin; no auth success claim',node:publicNode(node),wire:publicWire(wire)}));
  assert.equal(node.status,403);
  framing(node,wire,true);
});

async function exerciseWholeApp(t, nodeIngress) {
  t.diagnostic(JSON.stringify({node:process.version,miniflare:require(path.join(root,'node_modules/miniflare/package.json')).version,workerd:require(path.join(root,'node_modules/workerd/package.json')).version,
    frozenEntrySha256:createHash('sha256').update(fs.readFileSync(path.join(frozen,'dist/server/index.js'))).digest('hex'),browserAcceptance:'NOT_RUN'}));
  let mf,server,origin,port;
  if(nodeIngress){
    // Diagnostic local harness only. The delivered Worker is loaded unchanged;
    // the Node TLS terminator forwards its original HTTPS origin to dispatchFetch.
    // A 200,000-byte cap prevents this comparison adapter buffering without bound.
    server=https.createServer({cert:fs.readFileSync(certPath),key:fs.readFileSync(keyPath),minVersion:'TLSv1.2'},async(req,res)=>{
      try{
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>200000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        const target=new URL(req.url,origin);if(target.origin!==origin){res.writeHead(400);res.end();return;}
        const response=await mf.dispatchFetch(target.href,{method:req.method,headers:req.headers,
          ...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
        const bytes=Buffer.from(await response.arrayBuffer());
        const headers=Object.fromEntries(response.headers);
        // dispatchFetch may expose internal hop/encoding metadata after its body
        // decoder. The local buffer has an exact wire length of its own.
        for(const name of ['transfer-encoding','connection','content-length','mf-content-encoding'])delete headers[name];
        headers['content-length']=String(bytes.length);
        const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
        res.writeHead(response.status,headers);res.end(bytes);
      }catch{res.writeHead(502);res.end('local diagnostic adapter failed');}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    origin=`https://127.0.0.1:${server.address().port}`;port=0;
  }else {port=await freePort();origin=`https://127.0.0.1:${port}`;}
  mf = new Miniflare({name:'lantern-framing-frozen-app-https'+(nodeIngress?'-node-ingress':''),modules:true,
    scriptPath:path.join(frozen,'dist/server/index.js'),modulesRoot:path.join(frozen,'dist/server'),
    modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs']}],
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,
    host:'127.0.0.1',port,...(nodeIngress?{}:{https:true,httpsCertPath:certPath,httpsKeyPath:keyPath}),
    assets:{directory:path.join(frozen,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
    d1Databases:{DB:'lantern-framing-independent-memory-https'},d1Persist:false,
    bindings:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:origin},
    outboundService:()=>new Response('External requests disabled',{status:502}),log:new Log(LogLevel.ERROR)});
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await mf.dispose();}); await mf.ready;
  const db=await mf.getD1Database('DB');
  for(const name of fs.readdirSync(path.join(frozen,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()) {
    const statements=fs.readFileSync(path.join(frozen,'drizzle',name),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
    await db.batch(statements.map(s=>db.prepare(s)));
  }
  const password='Synthetic framing-only password phrase 2026!';
  const register=async name=>{
    const response=await nodeRequest(origin,'/api/auth/register',JSON.stringify({username:name,password}),{headers:{Origin:origin}});
    assert.equal(response.status,200);assert.equal(response.complete,true);
    const attributes=response.headers['set-cookie'][0].split(';').slice(1).join(';');
    assert.match(attributes,/ Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
    return {id:JSON.parse(response.body).user.id,cookie:response.headers['set-cookie'][0].split(';')[0]};
  };
  const a=await register('framing_only_a'),b=await register('framing_only_b');
  const profile={name:'Synthetic framing',lrGoal:650,speakingGoal:0,examDate:'',dailyMinutes:25,timezone:'Etc/UTC',theme:'paper',weeklyTarget:4,onboarded:true};
  const payload=JSON.stringify({type:'profile',data:profile});
  const cases=[
    {label:'Study A session with B owner',route:'/api/study',body:payload,status:409,headers:{Origin:origin,Cookie:a.cookie,'X-Lantern-Owner':b.id}},
    {label:'Study missing Origin',route:'/api/study',body:payload,status:403,headers:{Cookie:a.cookie,'X-Lantern-Owner':a.id}},
    {label:'Logout exact UI body',route:'/api/auth/logout',body:'{}',status:200,headers:{Origin:origin,Cookie:a.cookie}},
    {label:'Logout no payload control',route:'/api/auth/logout',body:null,status:200,headers:{Origin:origin,Cookie:b.cookie}},
  ];
  for(const row of cases) {
    const node=await nodeRequest(origin,row.route,row.body,{headers:row.headers});
    const wire=await wireRequest(origin,row.route,row.body,{headers:row.headers});
    t.diagnostic(JSON.stringify({scope:'frozen full app HTTPS, exact QA routes; no browser claim',nodeIngress,case:row.label,node:publicNode(node),wire:publicWire(wire)}));
    assert.equal(node.status,row.status);assert.equal(wire.status,row.status);
    framing(node,wire,nodeIngress||row.body===null);
    if(row.body===null){assert.equal(node.complete,true);assert.equal(node.body,'{"ok":true}');assert.equal(wire.body,'{"ok":true}');}
  }
  for(const user of [a,b]){
    const replay=await nodeRequest(origin,'/api/auth/session',null,{method:'GET',headers:{Cookie:user.cookie}});
    assert.equal(replay.status,401);assert.equal(replay.complete,true);
  }
}

test('frozen whole app reproduces logout 200 and Study 409/403 HTTPS framing', {timeout:60000,skip:tlsIssue||frozenIssue}, t=>exerciseWholeApp(t,false));
test('diagnostic Node TLS ingress preserves complete frozen-app responses without product changes', {timeout:60000,skip:tlsIssue||frozenIssue}, t=>exerciseWholeApp(t,true));
