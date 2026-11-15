// Review-only preflight. No service, secret, disk, network or environment is
// touched during import. This module intentionally DOES NOT ENABLE production.
import path from 'node:path';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const expected=Object.freeze({
 // Both pinned 0007 byte variants have been independently checked to differ
 // only by CRLF/LF. The ledger still has to match an explicitly pinned hash.
 '0007_phone_auth.sql':Object.freeze(['4c9cbfa1a1b7554556b464f128ccb6dae9fed183b008b614ef7dba2d779112f4','1c9e0334bf1f532bd9f201b9b36c886bc008d255d88270706b20e44ebeee1144']),
 '0008_phone_challenges.sql':Object.freeze(['e529b5f26ffb853116c2d82c3cccbecb453b67e19b53a587a4a06f9b8e373cd5']),
});
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const integer=n=>Number.isSafeInteger(n)&&n>0;
export function parseProductionPhonePolicy(input){
 if(input===undefined)return Object.freeze({enabled:false});
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.enabled!=='boolean')throw Error('invalid phone configuration');
 if(!input.enabled){if(!exact(input,['enabled']))throw Error('invalid disabled configuration');return Object.freeze({enabled:false});}
 const fields=['enabled','origin','signature','schemeName','templates','referenceKeyFile','limits'];
 if(!exact(input,fields))throw Error('incomplete phone configuration');
 let origin;try{origin=new URL(input.origin);}catch{throw Error('invalid phone origin');}
 if(origin.protocol!=='https:'||origin.origin!==input.origin||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('invalid phone origin');
 if(typeof input.signature!=='string'||!input.signature.trim()||input.signature.length>100||/[\r\n\0]/.test(input.signature))throw Error('invalid signature');
 if(typeof input.schemeName!=='string'||!input.schemeName.trim()||input.schemeName.length>20||/[\r\n\0]/.test(input.schemeName))throw Error('invalid issuer scheme');
 if(!input.templates||typeof input.templates!=='object'||Array.isArray(input.templates)||Object.keys(input.templates).some(x=>!['login','bind'].includes(x))||
  (input.templates.login!==undefined&&input.templates.login!=='100001')||(input.templates.bind!==undefined&&input.templates.bind!=='100004')||!Object.keys(input.templates).length)throw Error('invalid templates');
 if(typeof input.referenceKeyFile!=='string'||!path.posix.isAbsolute(input.referenceKeyFile)||input.referenceKeyFile.includes('\0'))throw Error('invalid key file');
 if(!exact(input.limits,['maxSendsPerUtcDay','maxSendsPerMinute','maxSendsPerPhoneHour','maxVerificationsPerPhoneTenMinutes'])||Object.values(input.limits).some(x=>!integer(x))||
  input.limits.maxSendsPerMinute>input.limits.maxSendsPerUtcDay||input.limits.maxSendsPerPhoneHour>input.limits.maxSendsPerUtcDay)throw Error('invalid explicit budget or limits');
 return Object.freeze({enabled:true,origin:input.origin,signature:input.signature,schemeName:input.schemeName,templates:Object.freeze({...input.templates}),referenceKeyFile:input.referenceKeyFile,limits:Object.freeze({...input.limits})});
}
export function validatePhoneMigrationLedger(rows){
 if(!Array.isArray(rows)||rows.length!==2)throw Error('phone migration ledger incomplete');
 const found=new Map();for(const row of rows){if(!exact(row,['name','sha'])||!Object.hasOwn(expected,row.name)||found.has(row.name)||!expected[row.name].includes(row.sha))throw Error('phone migration ledger mismatch');found.set(row.name,row.sha);}
 if(found.size!==2)throw Error('phone migration ledger incomplete');return true;
}
export function validatePhoneDatabaseState({ledgerRows,schemaRows}={}){
 validatePhoneMigrationLedger(ledgerRows);
 if(!Array.isArray(schemaRows)||schemaRows.length!==8)throw Error('phone schema incomplete');
 // SQLite preserves migration line endings. Normalize CRLF pairs only; do not
 // normalize whitespace, comments, field names, constraints, or ordering.
 const entries=schemaRows.map(({type,name,tbl_name,sql})=>({type,name,tbl_name,sql:typeof sql==='string'?sql.replace(/\r\n/g,'\n'):sql}));
 const fingerprint=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 if(fingerprint!=='f9a2f9a8034e9daaee26a8813839a9f4923ac7abf56f5580b0c89002edffe1b9')throw Error('phone schema mismatch');
 return true;
}
// Runtime policy must be read from the exact Worker being started, never from
// an untrusted request or a copy chosen by the caller.
export function validateLimiterCompatibility(config,runtime){
 if(config?.enabled!==true||!config.limits||!runtime)throw Error('limiter unavailable');
 const checks=[['sendGlobalDaily',86400000,config.limits.maxSendsPerUtcDay],['sendGlobal',60000,config.limits.maxSendsPerMinute],['sendPhone',3600000,config.limits.maxSendsPerPhoneHour],['verifyPhone',600000,config.limits.maxVerificationsPerPhoneTenMinutes]];
 for(const [name,span,max] of checks)if(runtime[name]?.span!==span||runtime[name]?.max!==max)throw Error('limiter policy mismatch');
 return true;
}
export function isPrivateOwnedFile(stat,uid){return !!stat&&Number.isSafeInteger(uid)&&uid>0&&stat.uid===uid&&(stat.mode&0o077)===0&&stat.nlink===1&&stat.isFile()&&!stat.isSymbolicLink();}
/** Linux non-root only. Caller must supply an approved canonical private root;
 * deployment must additionally control all ancestors/mounts/backup access. */
export async function readProductionReferenceKey(file,privateRoot){
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||process.geteuid()===0)throw Error('non-root Linux required');
 const uid=process.geteuid();
 if(typeof file!=='string'||typeof privateRoot!=='string'||!path.isAbsolute(file)||!path.isAbsolute(privateRoot)||path.dirname(file)!==privateRoot||await realpath(privateRoot)!==privateRoot)throw Error('invalid key location');
 const dir=await lstat(privateRoot);if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==uid||(dir.mode&0o077)!==0)throw Error('unsafe key directory');
 const before=await lstat(file);if(!isPrivateOwnedFile(before,uid)||before.size!==64)throw Error('unsafe key file');
 const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const opened=await fd.stat(),after=await lstat(file);
  if(!isPrivateOwnedFile(opened,uid)||!isPrivateOwnedFile(after,uid)||opened.dev!==before.dev||opened.ino!==before.ino||after.dev!==opened.dev||after.ino!==opened.ino||opened.size!==before.size)throw Error('key changed');
  const text=await fd.readFile('utf8'),last=await fd.stat();
  if(!/^[a-f0-9]{64}$/.test(text)||last.ino!==opened.ino||last.size!==opened.size||last.mtimeMs!==opened.mtimeMs||last.ctimeMs!==opened.ctimeMs||last.nlink!==1)throw Error('invalid key file');
  return Buffer.from(text,'hex');
 }finally{await fd.close();}
}
// Intentionally no enable/start API: actual store policy remains hard-coded and
// production credentials, migrations, routing and recovery are not complete.
