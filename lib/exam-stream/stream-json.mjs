import { Sha256 } from './sha256.mjs';
export class AssetReference { constructor(value) { Object.assign(this, value); } }
class OversizedString { constructor(chars){this.chars=chars;} }
const assetPath = path => (path.length === 3 && path[0] === 'assets' && Number.isInteger(path[1]) && path[2] === 'base64') || (path.length === 5 && path[0] === 'packages' && Number.isInteger(path[1]) && path[2] === 'assets' && Number.isInteger(path[3]) && path[4] === 'base64');
const abortCheck = signal => { if(signal?.aborted)throw signal.reason??new DOMException('Cancelled','AbortError'); };

class Base64Sink {
  constructor(spool) { this.spool=spool;this.carry='';this.chars=0;this.bytes=0;this.head=new Uint8Array(0);this.error=undefined; }
  async push(text) {
    this.chars+=text.length;
    if(this.error)return;
    try {
      if(!/^[A-Za-z0-9+/=]*$/.test(text))throw new Error('Invalid base64 alphabet');
      const joined=this.carry+text;
      if(joined.length<16*1024){this.carry=joined;return;}
      const length=Math.max(0,Math.floor((joined.length-4)/4)*4);
      this.carry=joined.slice(length);
      if(length)await this.decode(joined.slice(0,length),false);
    }catch(error){this.error=error.message;}
  }
  async decode(text,final) {
    if(final){if(!text.length||text.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(text)||btoa(atob(text))!==text)throw new Error('Invalid canonical base64 padding');}
    else if(text.includes('='))throw new Error('Base64 padding before end');
    const raw=atob(text), out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
    if(this.head.length<16){const n=Math.min(16-this.head.length,out.length), head=new Uint8Array(this.head.length+n);head.set(this.head);head.set(out.subarray(0,n),this.head.length);this.head=head;}
    this.bytes+=out.length; await this.spool.write(out);
  }
  async finish() {
    if(!this.error)try{await this.decode(this.carry,true);}catch(error){this.error=error.message;}
    await this.spool.close();
    return new AssetReference({id:this.spool.id,base64Chars:this.chars,bytes:this.bytes,head:this.head,error:this.error});
  }
}

/** Strict JSON grammar, UTF-8 fatal, JSON escape handling, duplicate keys last-wins.
 * Only root/package assets[].base64 is spooled; domain validation is a separate step.
 */
export async function parseStreamingJson(file, stage, {maxBytes=96*1024**2,signal,hashFactory=()=>new Sha256(),decodeBytes=16*1024,maxDepth=128,maxStringChars=30000,guardKey}={}) {
  if(!Number.isSafeInteger(file?.size)||file.size<1||file.size>maxBytes)throw new Error('File size exceeds declared import limit');
  abortCheck(signal);
  const reader=file.stream().getReader(), decoder=new TextDecoder('utf-8',{fatal:true}), hash=hashFactory();
  let raw=new Uint8Array(0), rawAt=0, text='', at=0, received=0, ended=false, nodes=0,maxRetainedStringChars=0;
  const cancel=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  async function more(){
    abortCheck(signal);
    if(at<text.length)return true;
    while(true){
      if(rawAt<raw.length){const end=Math.min(raw.length,rawAt+decodeBytes);text=decoder.decode(raw.subarray(rawAt,end),{stream:true});rawAt=end;at=0;if(text.length)return true;continue;}
      if(ended)return false;
      const next=await reader.read();abortCheck(signal);
      if(next.done){ended=true;if(received!==file.size)throw new Error('Truncated JSON stream');text=decoder.decode();at=0;return !!text.length;}
      if(!(next.value instanceof Uint8Array))throw new Error('Byte chunks required');
      received+=next.value.length;if(received>file.size)throw new Error('JSON stream exceeds declared size');
      hash.update(next.value);raw=next.value;rawAt=0;
    }
  }
  async function peek(){return await more()?text[at]:'';}
  async function take(){const c=await peek();if(c)at++;return c;}
  async function whitespace(){while(await more()){const match=/[^\x20\t\r\n]/.exec(text.slice(at));if(match){at+=match.index;return;}at=text.length;}}
  async function string(path,isKey=false){
    if(await take()!=='"')throw new Error('JSON string expected');
    const sink=!isKey&&assetPath(path)?new Base64Sink(await stage.createSink(path)):undefined;
    const parts=[];let chars=0,oversized=false;
    const append=async value=>{chars+=value.length;if(sink)await sink.push(value);else if(chars>maxStringChars){oversized=true;parts.length=0;}else if(!oversized){parts.push(value);maxRetainedStringChars=Math.max(maxRetainedStringChars,chars);}};
    while(await more()){
      const remaining=text.slice(at), special=/["\\\u0000-\u001f]/.exec(remaining), count=special?special.index:remaining.length;
      if(count){await append(remaining.slice(0,count));at+=count;}
      if(!special)continue;
      const c=text[at++];
      if(c==='"'){if(isKey&&oversized)throw new Error('JSON key exceeds schema bounds');return sink?await sink.finish():oversized?new OversizedString(chars):parts.join('');}
      if(c!=='\\')throw new Error('Unescaped JSON control character');
      const escape=await take();
      const simple={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
      if(Object.hasOwn(simple,escape))await append(simple[escape]);
      else if(escape==='u'){let hex='';for(let i=0;i<4;i++)hex+=await take();if(!/^[0-9a-fA-F]{4}$/.test(hex))throw new Error('Invalid JSON unicode escape');await append(String.fromCharCode(parseInt(hex,16)));}
      else throw new Error('Invalid JSON escape');
    }
    throw new Error('Unterminated JSON string');
  }
  async function value(path,depth=0){
    if(depth>maxDepth)throw new Error('JSON nesting exceeds schema safety depth');
    if(++nodes>2000000)throw new Error('JSON node count exceeds safety limit');
    await whitespace();const c=await peek();
    if(c==='"')return string(path);
    if(c==='{'){
      at++;const object={};await whitespace();if(await peek()==='}'){at++;return object;}
      while(true){await whitespace();const key=await string(path,true);guardKey?.(path,key);await whitespace();if(await take()!==':')throw new Error('JSON colon expected');const item=await value([...path,key],depth+1);Object.defineProperty(object,key,{value:item,writable:true,enumerable:true,configurable:true});await whitespace();const end=await take();if(end==='}')return object;if(end!==',')throw new Error('JSON object separator expected');}
    }
    if(c==='['){at++;const array=[];await whitespace();if(await peek()===']'){at++;return array;}while(true){array.push(await value([...path,array.length],depth+1));await whitespace();const end=await take();if(end===']')return array;if(end!==',')throw new Error('JSON array separator expected');}}
    if(c==='t'||c==='f'||c==='n'){const word=c==='t'?'true':c==='f'?'false':'null';for(const expected of word)if(await take()!==expected)throw new Error('Invalid JSON literal');return word==='true'?true:word==='false'?false:null;}
    if(c==='-'||/[0-9]/.test(c)&&c){let number='';while(await more()){const part=/^[0-9eE+.-]+/.exec(text.slice(at))?.[0];if(!part)break;number+=part;at+=part.length;}return JSON.parse(number);}
    throw new Error('Unexpected JSON token');
  }
  try {const result=await value([]);await whitespace();if(await peek()!=='')throw new Error('Trailing JSON data');return {value:result,rawSha256:hash.hex(),bytes:received,stats:{nodes,decodeBytes,maxRetainedStringChars}};}
  catch(error){void reader.cancel(error).catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}
