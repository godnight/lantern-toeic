import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url));
const child=spawn(process.execPath,[vite,'--config','mobile/vite.config.ts',...process.argv.slice(2)],{
 cwd:root,
 env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/wrangler.log'},
 stdio:'inherit',
 windowsHide:true,
});

for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(child.exitCode===null&&child.signalCode===null)child.kill(signal);});
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
