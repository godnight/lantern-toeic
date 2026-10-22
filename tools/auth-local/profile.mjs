import {readFile,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {X509Certificate} from 'node:crypto';
import * as https from 'node:https';
import * as tls from 'node:tls';
import * as net from 'node:net';

export const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const wranglerConfig=path.join(repoRoot,'tools/auth-local/wrangler.json');
export class AuthLocalError extends Error {
 constructor(code,message){super(message);this.name='AuthLocalError';this.code=code;}
}
export function localProfile(env=process.env){
 const raw=env.LANTERN_LOCAL_AUTH_PORT||'9443';
 if(!['9443','9444'].includes(raw))throw new AuthLocalError('INVALID_PORT','仅允许 QA 9443 或开发 9444；不自动换端口。');
 if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new AuthLocalError('INSECURE_TLS_ENV','请移除关闭 TLS 校验的环境设置；本工具不会跳过验证。');
 const port=Number(raw),root=path.join(repoRoot,'.auth-local',raw);
 return {port,origin:`https://localhost:${port}`,host:'127.0.0.1',root,state:path.join(root,'state'),cache:path.join(root,'vite-cache')};
}
export async function assertLocalEnvironment(env=process.env){
 const external=['CLOUDFLARE_ENV','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_KEY','CF_API_KEY','CF_EMAIL'];
 if(external.some(name=>env[name])||Object.keys(env).some(name=>name.startsWith('WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_')&&env[name]))throw new AuthLocalError('EXTERNAL_ENV_PRESENT','请在不带外部账号/环境选择变量的独立终端运行；不读取或打印这些值。');
 for(const directory of [repoRoot,path.dirname(wranglerConfig)]){
  if((await readdir(directory)).some(name=>/^\.(?:env|dev\.vars)(?:\.|$)/.test(name)))throw new AuthLocalError('LOCAL_ENV_FILES_PRESENT','本地验证目录存在 .env/.dev.vars 文件；请改用干净独立 worktree，不删除或读取原配置。');
 }
}
export async function assertPortFree(profile){
 const probe=net.createServer();
 await new Promise((resolve,reject)=>{
  probe.once('error',()=>reject(new AuthLocalError('PORT_IN_USE',`${profile.host}:${profile.port} 不可用；不终止其他进程或更换端口。`)));
  probe.listen({host:profile.host,port:profile.port,exclusive:true},()=>probe.close(resolve));
 });
}
export async function externalPrivateKeyPath(input){
 const resolved=await realpath(input),relative=path.relative(repoRoot,resolved);
 if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new AuthLocalError('TLS_KEY_IN_REPO','私钥必须位于整个源码目录之外；不能放入 public 或依赖扩展名隐藏。');
 return resolved;
}
/** Uses existing certificate files only. Never generates, imports or trusts a CA. */
export async function trustedLocalTls(env=process.env){
 if(typeof tls.getCACertificates!=='function')throw new AuthLocalError('NODE_TLS_API_REQUIRED','本地 HTTPS 预检需要带 getCACertificates 的 Node（当前基线 Node 24.13.1）。');
 if(!env.LANTERN_LOCAL_TLS_CERT||!env.LANTERN_LOCAL_TLS_KEY)throw new AuthLocalError('TLS_FILES_REQUIRED','缺少已受信任的 localhost 证书/私钥路径；未启动页面服务。参见本地运行手册。');
 let cert,certificate;
 try{cert=await readFile(env.LANTERN_LOCAL_TLS_CERT);certificate=new X509Certificate(cert);}
 catch{throw new AuthLocalError('TLS_CERT_INVALID','无法读取有效证书；未读取或输出私钥。');}
 if(!certificate.subjectAltName?.split(/,\s*/).includes('DNS:localhost')||!certificate.checkHost('localhost'))throw new AuthLocalError('TLS_HOST_MISMATCH','证书必须有匹配 localhost 的 DNS SAN；不能更换认证 origin 绕过。');
 if(Date.now()<Date.parse(certificate.validFrom)||Date.now()>Date.parse(certificate.validTo))throw new AuthLocalError('TLS_CERT_EXPIRED','本地证书不在有效期内。');
 // The leaf itself is never added as a trust anchor. Early rejection also avoids
 // opening a private-key file for the known untrusted self-signed QA certificate.
 const ca=[...tls.getCACertificates('bundled'),...tls.getCACertificates('system')];
 if(certificate.issuer===certificate.subject&&certificate.verify(certificate.publicKey)&&!ca.some(pem=>new X509Certificate(pem).fingerprint256===certificate.fingerprint256))throw new AuthLocalError('TLS_UNTRUSTED','localhost 自签证书不在既有系统/内置信任中；不会启动或安装信任。');
 let key,server;
 try{
  const privateKeyPath=await externalPrivateKeyPath(env.LANTERN_LOCAL_TLS_KEY);
  key=await readFile(privateKeyPath);
  server=https.createServer({cert,key,minVersion:'TLSv1.2'},(_request,response)=>response.end('local TLS probe'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  await new Promise((resolve,reject)=>{
   const request=https.get({hostname:'127.0.0.1',port:address.port,servername:'localhost',path:'/',ca,rejectUnauthorized:true,
    checkServerIdentity:(_host,peer)=>tls.checkServerIdentity('localhost',peer),agent:false},response=>{response.resume();response.once('end',resolve);});
   request.once('error',reject);request.setTimeout(5000,()=>request.destroy(new Error('TLS check timeout')));
  });
  return {cert,key,minVersion:'TLSv1.2',privateKeyPath};
 }catch(error){if(error instanceof AuthLocalError)throw error;throw new AuthLocalError('TLS_TRUST_OR_KEY_FAILED','严格 TLS 链/主机名/证书与私钥匹配检查未通过；未启动页面服务。');}
 finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
export async function localViteOptions(profile,httpsOptions){
 const [{default:vinext},{cloudflare}]=await Promise.all([import('vinext'),import('@cloudflare/vite-plugin')]);
 const {privateKeyPath,...secureOptions}=httpsOptions;
 return {
  root:repoRoot,envDir:false,cacheDir:profile.cache,
  server:{host:profile.host,port:profile.port,strictPort:true,origin:profile.origin,https:secureOptions,
   allowedHosts:['localhost'],cors:{origin:profile.origin},
   watch:{ignored:['**/.auth-local/**']},
   fs:{strict:true,allow:[repoRoot],deny:['.env','.env.*','**/.auth-local/**','**/*.{pem,key,pfx,p12}',...(privateKeyPath?[privateKeyPath]:[])]},
   hmr:{host:'localhost',protocol:'wss',clientPort:profile.port}},
  plugins:[{name:'auth-local-no-cli-shortcuts',enforce:'pre',configureServer(server){server.bindCLIShortcuts=()=>{};}},vinext(),cloudflare({
   configPath:wranglerConfig,remoteBindings:false,tunnel:false,inspectorPort:false,
   persistState:{path:profile.state},viteEnvironment:{name:'rsc',childEnvironments:['ssr']},
   config:{vars:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:profile.origin}}
  })]
 };
}
