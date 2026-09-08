import {accessSync,constants,existsSync} from 'node:fs';
import {delimiter,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2);
const sdk=args.find(a=>a.startsWith('--sdk='))?.slice(6)||process.env.LANTERN_HARMONY_SDK;
function findTool(names){
 for(const name of names)for(const dir of [root,...(process.env.PATH||'').split(delimiter)]){
  const path=resolve(dir,name);try{accessSync(path,process.platform==='win32'?constants.F_OK:constants.X_OK);return true;}catch{}
 }
 return false;
}
const tools={hvigor:findTool(['hvigorw','hvigorw.bat','hvigor','hvigor.bat']),ohpm:findTool(['ohpm','ohpm.bat']),hdc:findTool(['hdc','hdc.exe'])};
const report={checkedAt:new Date().toISOString(),tools,sdkDirectoryProvided:!!sdk,sdkDirectoryExists:!!sdk&&existsSync(sdk),missing:[...Object.entries(tools).filter(([,found])=>!found).map(([name])=>name),...(!sdk||!existsSync(sdk)?['HarmonyOS SDK directory']:[])],compiled:false,signed:false,deviceTested:false,note:'Only checks executable/directory presence. Use DevEco Studio to verify the SDK version, install dependencies, compile, sign and run on a device.'};
console.log(JSON.stringify(report,null,2));
if(report.missing.length&&!args.includes('--report-only'))process.exitCode=2;
