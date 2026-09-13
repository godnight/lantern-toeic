import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2);
const apiOrigin=args.find(value=>value.startsWith('--api-origin='))?.slice(13)||process.env.LANTERN_AUTH_API_ORIGIN||'';
const configPath=resolve(root,'AppScope/resources/rawfile/agconnect-services.json');
const packagePath=resolve(root,'entry/oh-package.json5');
const packageSource=readFileSync(packagePath,'utf8');
const apiOriginValid=/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(apiOrigin);
const checks={
  agconnectConfigPresent:existsSync(configPath),
  authSdkDeclared:packageSource.includes('"@hw-agconnect/auth"'),
  authApiOriginProvided:apiOrigin.length>0,
  authApiOriginHttps:apiOriginValid
};
const missing=Object.entries(checks).filter(([,ready])=>!ready).map(([name])=>name);
const report={
  provider:'AppGallery Connect Authentication',
  ready:missing.length===0,
  checks,
  missing,
  note:'Readiness only. A real phone OTP release also requires AGC console enablement, SMS policy, server-side token verification, SDK compilation and device acceptance.'
};
console.log(JSON.stringify(report,null,2));
if(!report.ready&&!args.includes('--report-only'))process.exitCode=2;
