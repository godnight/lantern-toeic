import metadata from '@/content/dictionary-metadata.json';
import {parseDictionary, type DictionaryPayload} from './dictionary-model';

let pending:Promise<DictionaryPayload>|null=null;
export function loadDictionary(){
  if(pending)return pending;
  pending=(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('/dictionaries/'+metadata.file,{signal:controller.signal});
      if(!response.ok)throw Error('词典文件未能读取，请重试。');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>64*1024*1024)throw Error('词典文件过大。');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==metadata.sha256)throw Error('词典文件校验失败，请重新打开应用后重试。');
      const parsed=parseDictionary(JSON.parse(new TextDecoder().decode(bytes)));
      if(parsed.entries.length!==metadata.count||parsed.source!==metadata.source)throw Error('词典版本或数量校验失败。');
      return parsed;
    }finally{clearTimeout(timer);}
  })().catch(error=>{pending=null;throw error;});
  return pending;
}
