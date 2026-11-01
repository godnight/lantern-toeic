// Offline review forms, NOT a Sites API schema or a deployment executor.
// This module has no write, network, credential, subprocess or serving capability.
import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';

export const PRODUCTION_PROJECT='appgprj_6a9e270c912c8191b5983b0f4cb42089';
export const PRODUCTION_HOST='lantern-toeic-godnight.zhuangzeliang.chatgpt.site';
export const LOCAL_DATABASE='efefefef-0000-4000-8000-000000009443';
const PURPOSE='isolated-auth-test';
const placeholder=/(?:placeholder|replace|changeme|unknown|example|template|todo|tbd|not[-_]?set)/i;
const productionAlias=/(?:^|[-_.:])(?:prod|production|live|main|default)(?:$|[-_.:])/i;
const message={
 INPUT_REQUIRED:'缺少显式非秘密目标或独立资源核对表；未读取任何默认配置。',
 INVALID_INPUT:'输入不是受支持的非秘密离线核对表；不回显原始值。',
 ENVIRONMENT_PRESENT:'存在认证、远端环境选择或凭据变量名；未读取其值。请使用干净终端。',
 METADATA_REQUIRED:'实际项目、账号、D1、绑定、域名或只读证据缺失、占位或不合法。',
 STALE_EVIDENCE:'只读核对表时间无效、过期或在未来，需重新核实实际资源。',
 PRODUCTION_TARGET:'拒绝现行生产项目、域名、数据库、别名或本地D1哨兵。',
 TARGET_MISMATCH:'目标与独立资源核对表的账号、项目、DB、hostname或绑定关系不相符。',
 ISOLATION_UNPROVEN:'缺少独立测试用途、独占DB及生产资源对照；test标记不能证明隔离。',
 AUTH_MUST_STAY_CLOSED:'准备阶段必须保持网络认证关闭且只允许空白合成账号。'
};
class NotReady extends Error{constructor(code){super(message[code]);this.code=code;}}
const stop=code=>{throw new NotReady(code);};
function shape(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.split(' ').sort().join(','))stop('INVALID_INPUT');
}
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,127}$/.test(value)&&!placeholder.test(value);
const projectId=value=>typeof value==='string'&&/^appgprj_[a-f0-9]{32}$/.test(value)&&!/^appgprj_([a-f0-9])\1{31}$/.test(value);
const databaseId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)&&!/^([a-f0-9])\1{7}-/.test(value);
const name=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{2,79}$/.test(value)&&!placeholder.test(value);
const testName=value=>name(value)&&/(?:^|-)test(?:-|$)/.test(value)&&!productionAlias.test(value);
function hostname(value){
 if(typeof value!=='string'||value.length>253||!value.includes('.')||!value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return false;
 return !/^[0-9.]+$/.test(value)&&!/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(value)&&!/(?:^|\.)example\.(?:com|net|org)$/.test(value)&&!placeholder.test(value);
}
function origin(value){
 try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.port&&!url.username&&!url.password&&hostname(url.hostname)?url.hostname:null;}catch{return null;}
}
function cleanEnvironment(names){
 if(!Array.isArray(names)||!names.every(item=>typeof item==='string'))stop('INVALID_INPUT');
 if(names.some(item=>/^(?:CLOUDFLARE_|CF_API_|CF_ACCOUNT_ID$|CF_EMAIL$|WRANGLER_|D1_DATABASE_|DATABASE_URL$|AUTH_API_ORIGIN$|LANTERN_AUTH_|LANTERN_LOCAL_TLS_|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$|SITES_(?:PROJECT_ID|ENV|API_|DEPLOY|TOKEN))/i.test(item)))stop('ENVIRONMENT_PRESENT');
}
const steps=Object.freeze([
 '仅由有权限的Sites集成者核平台实际可提供的测试项目、受信HTTPS域名及项目绑定资源证据；当前工具不提供CF账号或物理D1 ID，缺少本安全模型所需证据继续NOT_READY。本地表不证明平台事实或权限。',
 '取得并审核仅认证API和所需代码的部署输入：现有完整Sites/Web构建不是已核auth-only包；不上传完整Web/Shared媒体、学习或个人录音，不开放学习/录音接口。',
 '使用获准的原生Sites流程配置独立测试项目/DB、核必要增量迁移与部署范围；本工具无create/apply/deploy/remote migrate能力，不提供可执行发布命令。',
 '另行确认权限、费用、对外访问和严格HTTPS/同源cookie策略；不向App放平台管理token，不改现站owner-only权限。',
 '仅在目标、服务与最小输入真实获准后显式启用测试认证，验注册/登录/v2session/退出及失败关闭；只用空白合成账号，M1学习/录音上传仍关闭。',
 'Harmony AUTH_API_ORIGIN继续空；未来获准接入必须使用平台实际返回的精确受信HTTPS origin并单独验设备，localhost/lantern.local不能作远端API。'
]);
export function prepareAuthTest(target,inventory,{environmentNames=[],now=Date.now()}={}){
 try{
  cleanEnvironment(environmentNames);
  if(!target||!inventory)stop('INPUT_REQUIRED');
  shape(target,'schemaVersion platform accountId projectId origin database vars dataPolicy purpose');
  shape(target.database,'id name binding');shape(target.vars,'LANTERN_AUTH_ENABLED');
  shape(inventory,'schemaVersion platform accountId observedAt evidenceKind evidenceRefs projects databases');
  if(target.schemaVersion!==1||inventory.schemaVersion!==1||target.platform!=='sites'||inventory.platform!=='sites'||!['platform-readonly-review','synthetic-fixture'].includes(inventory.evidenceKind))stop('INVALID_INPUT');
  if(target.vars.LANTERN_AUTH_ENABLED!=='false'||target.dataPolicy!=='synthetic-only-empty')stop('AUTH_MUST_STAY_CLOSED');
  if(target.projectId===PRODUCTION_PROJECT||origin(target.origin)===PRODUCTION_HOST||target.database.id===LOCAL_DATABASE||productionAlias.test(target.database.name))stop('PRODUCTION_TARGET');
  if(!identifier(target.accountId)||!projectId(target.projectId)||!origin(target.origin)||!databaseId(target.database.id)||!testName(target.database.name)||target.database.binding!=='DB')stop('METADATA_REQUIRED');
  if(target.purpose!==PURPOSE||!Array.isArray(inventory.projects)||!Array.isArray(inventory.databases)||inventory.projects.length!==2||inventory.databases.length!==2)stop('ISOLATION_UNPROVEN');
  if(!identifier(inventory.accountId)||!Array.isArray(inventory.evidenceRefs)||inventory.evidenceRefs.length<1||inventory.evidenceRefs.length>8||!inventory.evidenceRefs.every(identifier))stop('METADATA_REQUIRED');
  const observed=Date.parse(inventory.observedAt);
  if(typeof inventory.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(inventory.observedAt)||!Number.isFinite(observed)||new Date(observed).toISOString()!==inventory.observedAt||!Number.isFinite(now)||now-observed<0||now-observed>86400000)stop('STALE_EVIDENCE');
  for(const item of inventory.projects){
   shape(item,'id accountId name purpose hostname databaseId databaseBinding');
   if(!projectId(item.id)||!identifier(item.accountId)||!name(item.name)||!hostname(item.hostname)||!databaseId(item.databaseId)||item.databaseBinding!=='DB')stop('METADATA_REQUIRED');
  }
  for(const item of inventory.databases){
   shape(item,'id accountId name purpose projectIds');
   if(!databaseId(item.id)||item.id===LOCAL_DATABASE||!identifier(item.accountId)||!name(item.name)||!Array.isArray(item.projectIds)||item.projectIds.length!==1||!item.projectIds.every(projectId))stop('ISOLATION_UNPROVEN');
  }
  if(new Set(inventory.projects.map(item=>item.id)).size!==2||new Set(inventory.databases.map(item=>item.id)).size!==2)stop('ISOLATION_UNPROVEN');
  const prod=inventory.projects.find(item=>item.id===PRODUCTION_PROJECT),test=inventory.projects.find(item=>item.id===target.projectId);
  const prodDb=inventory.databases.find(item=>item.id===prod?.databaseId),db=inventory.databases.find(item=>item.id===target.database.id);
  if(!prod||!prodDb||prod.purpose!=='production'||prodDb.purpose!=='production'||prod.hostname!==PRODUCTION_HOST||prodDb.projectIds[0]!==prod.id)stop('ISOLATION_UNPROVEN');
  if(target.database.id===prodDb.id||target.database.name===prodDb.name||target.origin===`https://${prod.hostname}`)stop('PRODUCTION_TARGET');
  if(!test||!db||test.purpose!==PURPOSE||db.purpose!==PURPOSE||!testName(test.name)||!testName(db.name)||productionAlias.test(test.hostname))stop('ISOLATION_UNPROVEN');
  if([...inventory.projects,...inventory.databases].some(item=>item.accountId!==inventory.accountId)||target.accountId!==inventory.accountId||test.databaseId!==db.id||db.projectIds[0]!==test.id||test.hostname!==origin(target.origin)||db.name!==target.database.name||test.name===prod.name)stop('TARGET_MISMATCH');
  return {status:'PLAN_ONLY',ready:false,applySupported:false,externalVerification:'NOT_VERIFIED',evidenceKind:inventory.evidenceKind,
   target:{platform:'sites',accountId:target.accountId,projectId:test.id,origin:target.origin,database:{id:db.id,name:db.name,binding:'DB'}},
   requiredConfiguration:{LANTERN_AUTH_ENABLED:'false',requestedOrigin:target.origin,nativeAuthOrigin:'KEEP_EMPTY',dataPolicy:'synthetic-only-empty'},
   blockers:['PLATFORM_FACTS_AND_PERMISSIONS_NOT_VERIFIED','AUTH_ONLY_DEPLOY_INPUT_NOT_AVAILABLE','DEPLOYMENT_AND_REMOTE_MIGRATION_NOT_AUTHORIZED','HTTPS_AND_DEVICE_NOT_RUN'],nextSteps:[...steps]};
 }catch(error){
  return {status:'NOT_READY',ready:false,applySupported:false,code:error instanceof NotReady?error.code:'INVALID_INPUT',message:error instanceof NotReady?error.message:message.INVALID_INPUT};
 }
}

async function metadataFile(file){
 // Only explicit JSON review forms. Never load dotenv, private keys or backups.
 if(typeof file!=='string'||path.extname(file)!=='.json'||/(?:^|[\\/])\.|(?:secret|credential|backup|recording|private|token)/i.test(file))stop('INVALID_INPUT');
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)stop('INVALID_INPUT');
 return JSON.parse(await readFile(file,'utf8'));
}
export async function prepareFromFiles(args,environmentNames){
 try{
  cleanEnvironment(environmentNames);
  if(args.length===0)return prepareAuthTest(null,null,{environmentNames});
  if(args.length!==4||args[0]!=='--target'||args[2]!=='--inventory'||args[1]===args[3])stop('INVALID_INPUT');
  const target=await metadataFile(args[1]),inventory=await metadataFile(args[3]);
  return prepareAuthTest(target,inventory,{environmentNames});
 }catch(error){return {status:'NOT_READY',ready:false,applySupported:false,code:error instanceof NotReady?error.code:'INVALID_INPUT',message:error instanceof NotReady?error.message:message.INVALID_INPUT};}
}
