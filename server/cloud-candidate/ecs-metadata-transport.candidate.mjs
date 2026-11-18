// Fixed direct ECS metadata transport. No proxy, DNS, redirects or default
// fallback. Does not touch the network until invoked by the credential helper.
import http from 'node:http';
export function createEcsMetadataTransport(roleName){
 if(typeof roleName!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(roleName)||roleName==='.'||roleName==='..')throw Error('invalid metadata role');
 const token='http://100.100.100.200/latest/api/token';
 const credentials='http://100.100.100.200/latest/meta-data/ram/security-credentials/'+encodeURIComponent(roleName);
 return async(url,init={})=>{
  const isToken=url===token&&init.method==='PUT',isCredentials=url===credentials&&init.method==='GET';
  if((!isToken&&!isCredentials)||init.redirect!=='error'||!init.signal||init.signal.aborted)throw Error('metadata request rejected');
  const input=new Headers(init.headers),allowed=isToken?'x-aliyun-ecs-metadata-token-ttl-seconds':'x-aliyun-ecs-metadata-token';
  if([...input.keys()].join(',')!==allowed||!input.get(allowed))throw Error('metadata request rejected');
  if(isToken&&input.get(allowed)!=='60')throw Error('metadata request rejected');
  return new Promise((resolve,reject)=>{
   const target=new URL(url),req=http.request({hostname:'100.100.100.200',port:80,path:target.pathname,method:init.method,headers:{[allowed]:input.get(allowed)},signal:init.signal},res=>{
    let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>16384)res.destroy(Error('metadata response too large'));else chunks.push(chunk);});
    res.on('error',()=>reject(Error('metadata unavailable')));res.on('end',()=>{
     if(res.statusCode!==200)return reject(Error('metadata unavailable'));
     resolve(new Response(Buffer.concat(chunks),{status:200}));
    });
   });
   req.on('error',()=>reject(Error('metadata unavailable')));req.end();
  });
 };
}
