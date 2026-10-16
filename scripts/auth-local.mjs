import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {repoRoot,wranglerConfig,localProfile,trustedLocalTls,assertPortFree,assertLocalEnvironment} from '../tools/auth-local/profile.mjs';

const action=process.argv[2]||'check';
if(!['check','migrate','serve'].includes(action)||process.argv.length>3){
 console.error('用法：npm run auth:local -- check|migrate|serve；详见 docs/testing/AUTH-LOCAL-HTTPS-RUNBOOK.md');process.exitCode=2;
}else{
 let server;
 try{
  const profile=localProfile();
  await assertLocalEnvironment();
  // Keep diagnostics/runtime state local; never load a production .env or tunnel.
  process.env.WRANGLER_SEND_METRICS='false';process.env.WRANGLER_WRITE_LOGS='false';
  process.env.WRANGLER_LOG_PATH=path.join(profile.root,'wrangler.log');
  process.env.MINIFLARE_REGISTRY_PATH=path.join(profile.root,'registry');
  if(action==='migrate'){
   await mkdir(profile.state,{recursive:true});
   const args=[path.join(repoRoot,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--persist-to',profile.state,'--config',wranglerConfig];
   const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:repoRoot,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
   if(code!==0)throw new Error('Local D1 migration failed');
   console.log(`仅本地 D1 已初始化：${profile.state}；没有启动 HTTPS 页面。`);
  }else{
   await trustedLocalTls();await assertPortFree(profile);
   if(action==='check')console.log(`严格 TLS 与回环端口预检通过：${profile.origin}/account；浏览器仍须无证书警告。`);
   else{
    const {createServer}=await import('vite');
    server=await createServer({root:repoRoot,configFile:path.join(repoRoot,'tools/auth-local/vite.config.mjs')});
    await server.listen();
    console.log(`本地账号页：${profile.origin}/account；仅监听 ${profile.host}:${profile.port}。Ctrl+C 停服，保留本地合成数据。`);
    let closing=false;
    const close=async()=>{if(closing)return;closing=true;await server.close();process.exitCode=0;};
    process.once('SIGINT',close);process.once('SIGTERM',close);
   }
  }
 }catch(error){
  if(server)await server.close();
  console.error(`${error.code||'AUTH_LOCAL_FAILED'}: ${error.code?error.message:'本地操作失败；没有启动可供验收的账号页面。'}`);
  process.exitCode=2;
 }
}
