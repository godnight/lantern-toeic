export class RequestBodyTooLargeError extends Error {
 constructor(){super('Request body exceeds the byte limit');this.name='RequestBodyTooLargeError';}
}

export class RequestBodyReadError extends Error {
 constructor(){super('Request body could not be read');this.name='RequestBodyReadError';}
}

// Content-Length is not an authority: count delivered bytes before retaining or
// parsing them. The upstream transport can still deliver one oversized chunk.
export async function readBoundedRequestBody(request:Request,limit:number):Promise<ArrayBuffer>{
 if(!Number.isSafeInteger(limit)||limit<0)throw new RangeError('Invalid body byte limit');
 if(!request.body)return new ArrayBuffer(0);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  reader=request.body.getReader();
  const chunks:Uint8Array[]=[];let total=0;
  while(true){
   const {done,value}=await reader.read();if(done)break;
   if(!ArrayBuffer.isView(value)||value.BYTES_PER_ELEMENT!==1)throw new RequestBodyReadError();
   if(value.byteLength===0)continue;
   if(value.byteLength>limit-total)throw new RequestBodyTooLargeError();
   total+=value.byteLength;chunks.push(new Uint8Array(value));
  }
  const result=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return result.buffer;
 }catch(error){
  // Cancellation is best effort. A broken or never-settling producer must not
  // replace a known 413 with a different error or keep its response pending.
  try{void reader?.cancel().catch(()=>{});}catch{/* preserve the original failure */}
  if(error instanceof RequestBodyTooLargeError)throw error;
  throw new RequestBodyReadError();
 }finally{try{reader?.releaseLock();}catch{/* no outstanding read is retained */}}
}
