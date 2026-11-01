/** Presentation and capability contract only. No client value authenticates a user. */
export type IdentityView =
 | {status:'unknown';generation:number}
 | {status:'guest';namespace:'existing-device';generation:number}
 | {status:'product-session';maskedLabel:string;generation:number}
 | {status:'legacy-session';maskedLabel:string;generation:number};
export const ACCOUNT_CAPABILITIES={phoneLogin:false,productSession:false,claimLocalData:false,deleteCloudData:false,clearDeviceData:false} as const;
export function identityView(ready:boolean,owner:string|null,nativeMode:boolean,generation=0):IdentityView {
 if(!ready)return {status:'unknown',generation};
 // Native has no product-session transport yet. Passing a UID cannot enable it.
 if(nativeMode||!owner)return {status:'guest',namespace:'existing-device',generation};
 // This is only a label for the owner already supplied by the server, never an
 // authentication check. Native callers cannot enable a product session.
 const maskedLabel=owner.length>5?owner.slice(0,2)+'…'+owner.slice(-2):'已验证的站点身份';
 if(/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner))return {status:'product-session',maskedLabel,generation};
 return {status:'legacy-session',maskedLabel,generation};
}
export type RecoveryAction={kind:'retry'|'login'|'permission'|'identity'|'conflict'|'inspect';label:string;detail:string};
export function syncRecovery(issue:{status?:string;httpStatus?:number;reason?:string}):RecoveryAction {
 if(issue.httpStatus===401)return {kind:'login',label:'查看登录状态',detail:'同步暂停，须通过真实服务恢复登录；本机记录不转入访客。'};
 if(issue.httpStatus===403)return {kind:'permission',label:'查看访问权限',detail:'当前会话没有此服务的权限；重发同步不能授予权限。'};
 if(issue.httpStatus===409)return {kind:'identity',label:'核对当前身份',detail:'身份已变化，先核对账号；不自动刷新或更换数据归属。'};
 if(issue.status==='auth')return {kind:'identity',label:'核对账号状态',detail:'这是旧版保留的身份错误，请先核对真实身份和权限。'};
 if(issue.status==='missing'&&issue.httpStatus!==422)return {kind:'retry',label:'重新读取原录音',detail:'重试读取原文件，保留原元数据与归属；不会伪造音频或清除记录。'};
 if(issue.httpStatus===422)return {kind:'conflict',label:'保留备份并检查',detail:'记录或文件需要核对，不通过重新登录覆盖内容。'};
 if(issue.httpStatus===undefined&&issue.status==='blocked')return {kind:'inspect',label:'查看保存范围',detail:'先核对版本、存储和原始记录，保留备份。'};
 return {kind:'retry',label:'重新尝试',detail:'在原记录范围重试，使用原事件标识。'};
}
export const MIGRATION_CONTRACT={version:'preview-only-v1',writesEnabled:false,sourceScopes:['web-owner','web-local','harmony-device'],rules:[
 '新账号不自动接收旧站或此设备记录；用户名和手机号共用同一稳定身份。',
 '旧云数据需证明旧、新身份；本机记录需明确选择。',
 '先按领域预览和备份，保留原ID、发生时间、媒体摘要和迁移ID。',
 '重复迁移不新增事实；冲突停止该领域，失败或取消不删源。',
 '普通备份恢复不是跨账号认领；不改owner字符串绕过验证。',
]} as const;
