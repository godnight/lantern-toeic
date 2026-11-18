import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {readFile,mkdir,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {localProfile,trustedLocalTls,assertPortFree,localViteOptions,wranglerConfig,externalPrivateKeyPath,assertLocalEnvironment} from '../tools/auth-local/profile.mjs';

test('QA and development use separate loopback origins, ports and persistence',()=>{
 const qa=localProfile({}),dev=localProfile({LANTERN_LOCAL_AUTH_PORT:'9444'});
 assert.equal(qa.host,'127.0.0.1');assert.equal(qa.origin,'https://localhost:9443');
 assert.equal(dev.origin,'https://localhost:9444');assert.notEqual(qa.state,dev.state);
 assert.match(qa.state,/[\\/]\.auth-local[\\/]9443[\\/]state$/);
 for(const port of ['0','80','5173','9443junk','https://evil.test'])assert.throws(()=>localProfile({LANTERN_LOCAL_AUTH_PORT:port}),{code:'INVALID_PORT'});
 assert.throws(()=>localProfile({NODE_TLS_REJECT_UNAUTHORIZED:'0'}),{code:'INSECURE_TLS_ENV'});
});
test('missing TLS material fails closed before a page server can start',async()=>{
 await assert.rejects(trustedLocalTls({}),{code:'TLS_FILES_REQUIRED'});
 await assert.rejects(trustedLocalTls({LANTERN_LOCAL_TLS_CERT:'/nonexistent/cert.pem',LANTERN_LOCAL_TLS_KEY:'/nonexistent/key.pem'}),{code:'TLS_CERT_INVALID'});
});
test('occupied port is rejected rather than replacing another process or port',async t=>{
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await assert.rejects(assertPortFree({host:'127.0.0.1',port:server.address().port}),{code:'PORT_IN_USE'});
});
test('local profile pins origin and disables remote bindings and tunnels',async()=>{
 const options=await localViteOptions(localProfile({LANTERN_LOCAL_AUTH_PORT:'9444'}),{cert:Buffer.from('test-only-non-certificate'),key:Buffer.from('test-only-non-key')});
 assert.equal(options.envDir,false);assert.equal(options.server.host,'127.0.0.1');assert.equal(options.server.strictPort,true);
 assert.equal(options.server.origin,'https://localhost:9444');assert.ok(options.server.fs.deny.includes('**/.auth-local/**'));
 assert.equal(options.server.fs.strict,true);assert.equal(options.server.fs.allow.length,1);
 let bindings=0;const fakeServer={bindCLIShortcuts(){bindings++;}};
 options.plugins[0].configureServer(fakeServer);fakeServer.bindCLIShortcuts({customShortcuts:[{key:'t',action(){throw Error('Must not run');}}]});assert.equal(bindings,0);
 const config=JSON.parse(await readFile(wranglerConfig,'utf8'));
 assert.equal(config.vars.LANTERN_AUTH_ENABLED,'false');assert.equal(config.d1_databases[0].database_name,'lantern-auth-local-only');
 assert.equal(config.send_metrics,false);assert.equal('account_id' in config,false);assert.equal('project_id' in config,false);
});
test('private keys inside the source tree are rejected even without an extension',async t=>{
 await mkdir(localProfile({}).root,{recursive:true});
 const directory=await mkdtemp(path.join(localProfile({}).root,'key-path-test-')),file=path.join(directory,'private-without-extension');
 t.after(async()=>{await unlink(file);await rmdir(directory);});
 await writeFile(file,'synthetic non-key marker');
 await assert.rejects(externalPrivateKeyPath(file),{code:'TLS_KEY_IN_REPO'});
});
test('external credentials and alternate Cloudflare environments are rejected',async()=>{
 for(const name of ['CLOUDFLARE_ENV','CLOUDFLARE_API_TOKEN','CF_API_KEY','WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB'])await assert.rejects(assertLocalEnvironment({[name]:'synthetic-not-a-credential'}),{code:'EXTERNAL_ENV_PRESENT'});
 await assertLocalEnvironment({});
});
