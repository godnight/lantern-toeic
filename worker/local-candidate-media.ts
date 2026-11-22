import manifest from './local-candidate-media-manifest.json';

/** Local-candidate media is never added to the fixed public GitHub proxy.
 * This handler reads only the exact bundled candidate files from ASSETS.
 * The build is private-only and must not be treated as publication approval. */
type CandidateEntry={path:string;bytes:number;sha256:string;contentType:string};
type CandidateManifest={schemaVersion:number;status:string;packId:string;entries:readonly CandidateEntry[]};
export type CandidateAssets={fetch:(request:Request)=>Promise<Response>};
const PACK='v040-natural-572f7490ce71';
const MAX_BYTES=16*1024*1024;

function failure(request:Request,status:number,message:string,extra?:Record<string,string>):Response {
 return new Response(request.method==='HEAD'?null:message,{status,headers:{'Content-Type':'text/plain; charset=utf-8',
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});
}
function singleRange(value:string,size:number):{start:number;end:number}|null {
 const match=/^bytes=(\d*)-(\d*)$/.exec(value.trim());if(!match||(!match[1]&&!match[2]))return null;
 const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
 if(first!==null&&!Number.isSafeInteger(first)||last!==null&&!Number.isSafeInteger(last))return null;
 if(first===null){if(last===null||last<=0)return null;return {start:Math.max(0,size-last),end:size-1};}
 if(first>=size||last!==null&&last<first)return null;
 return {start:first,end:Math.min(last??size-1,size-1)};
}
async function readExact(response:Response,expected:number,controller:AbortController):Promise<Uint8Array<ArrayBuffer>> {
 if(!response.body)throw Error('Missing candidate body');
 const reader=response.body.getReader(),out=new Uint8Array(expected);let length=0;
 const cancel=()=>{void reader.cancel().catch(()=>undefined);};
 controller.signal.addEventListener('abort',cancel,{once:true});
 try{
  for(;;){if(controller.signal.aborted)throw Error('Candidate cancelled');const {done,value}=await reader.read();if(controller.signal.aborted)throw Error('Candidate cancelled');if(done)break;if(length+value.byteLength>expected)throw Error('Candidate too large');out.set(value,length);length+=value.byteLength;}
  if(length!==expected)throw Error('Candidate truncated');return out;
 }catch(error){controller.abort();await reader.cancel().catch(()=>undefined);throw error;}
 finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
}

/** Test seam accepts only a fixed manifest snapshot; production uses the
 * compiled manifest and never accepts a request-selected source or path. */
export function createLocalCandidateMediaHandler(input:CandidateManifest,timeoutMs=20000){
 if(!input||input.schemaVersion!==1||input.status!=='PRIVATE_LOCAL_ONLY'||input.packId!==PACK||
   !Array.isArray(input.entries)||input.entries.length!==14||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid local candidate manifest');
 const entries=new Map<string,CandidateEntry>();let audio=0,json=0;
 for(const entry of input.entries){
  if(!entry||typeof entry.path!=='string'||!entry.path.startsWith('/audio/natural/'+PACK+'/')||
    !new RegExp('^/audio/natural/'+PACK+'/(?:[a-f0-9]{64}\\.mp3|admission\\.json|manifest\\.json)$').test(entry.path)||
    entries.has(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>MAX_BYTES||
    typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||
    entry.contentType!==(entry.path.endsWith('.mp3')?'audio/mpeg':'application/json'))throw Error('Invalid local candidate entry');
  if(entry.path.endsWith('.mp3')){if(!entry.path.endsWith('/'+entry.sha256+'.mp3'))throw Error('Invalid local candidate audio identity');audio++;}else json++;
  entries.set(entry.path,Object.freeze({...entry}));
 }
 if(audio!==12||json!==2||!entries.has('/audio/natural/'+PACK+'/manifest.json')||!entries.has('/audio/natural/'+PACK+'/admission.json'))throw Error('Incomplete local candidate manifest');
 return async(request:Request,assets:CandidateAssets):Promise<Response|null>=>{
  const entry=entries.get(new URL(request.url).pathname);if(!entry)return null;
  if(request.method!=='GET'&&request.method!=='HEAD')return failure(request,405,'Method not allowed',{Allow:'GET, HEAD'});
  const etag='"sha256-'+entry.sha256+'"',rangeHeader=request.headers.get('Range'),ifRange=request.headers.get('If-Range');
  const useRange=rangeHeader!==null&&(ifRange===null||ifRange===etag),range=useRange?singleRange(rangeHeader,entry.bytes):null;
  if(useRange&&!range)return failure(request,416,'Range not satisfiable',{'Content-Range':`bytes */${entry.bytes}`,'Accept-Ranges':'bytes'});
  const controller=new AbortController();let deadline:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{deadline=setTimeout(()=>{controller.abort();reject(Error('Candidate timed out'));},timeoutMs);});
  const work=async()=>{
   // Never forward caller credentials, query, range or identity to ASSETS.
   const url=new URL(entry.path,request.url);
   const response=await assets.fetch(new Request(url,{method:'GET',headers:{Accept:entry.contentType,'Accept-Encoding':'identity'},redirect:'manual',signal:controller.signal}));
   if(controller.signal.aborted)throw Error('Candidate cancelled');
   const type=response.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase();
   const length=response.headers.get('Content-Length'),encoding=response.headers.get('Content-Encoding');
   if(response.status!==200||response.redirected||type!==entry.contentType||
     length!==null&&(!/^\d+$/.test(length)||Number(length)!==entry.bytes)||encoding&&encoding.toLowerCase()!=='identity')throw Error('Invalid candidate response');
   const bytes=await readExact(response,entry.bytes,controller);
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
   if(Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('')!==entry.sha256)throw Error('Candidate SHA mismatch');
   const headers=new Headers({'Content-Type':entry.contentType,'Content-Length':String(range?range.end-range.start+1:entry.bytes),
    'Accept-Ranges':'bytes',ETag:etag,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
   if(range)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${entry.bytes}`);
   const body=request.method==='HEAD'?null:range?bytes.slice(range.start,range.end+1):bytes;
   return new Response(body,{status:range?206:200,headers});
  };
  try{return await Promise.race([work(),timeout]);}
  catch{controller.abort();return failure(request,502,'Local candidate unavailable');}
  finally{if(deadline!==undefined)clearTimeout(deadline);}
 };
}

export const handleLocalCandidateMedia=createLocalCandidateMediaHandler(manifest);
