// The production product-auth routes verify real session cookies before the
// recording route runs. Reuse the SQLite / R2 adapters; never substitute an owner.
const {environment:accountEnvironment}=require('./product-auth-harness.cjs');
async function environment(){
 const e=accountEnvironment(),users={alice:await e.register('alice'),bob:await e.register('bob')};
 const calls={put:[],get:[],delete:[]},hooks={},prompt=e.load('content/speaking.json')[0];
 for(const [method,list]of [['Put','put'],['Get','get'],['Delete','delete']])e.storage['before'+method]=async key=>{calls[list].push(key);await hooks['before'+method]?.(key);};
 e.storage.afterPut=key=>hooks.afterPut?.(key);
 // Failure injection concerns the recording D1 transaction only. Session reads
 // remain real and available so these tests cannot turn storage faults into auth.
 for(const phase of ['beforeSql','afterSql'])e.hooks[phase]=(...args)=>/\b(?:from|into)\s+["`]?recordings["`]?\b/i.test(args[0])?hooks[phase]?.(...args):undefined;
 function upload(owner,id,bytes='fixture-a',extra={},headers={}){
  const form=new FormData(),user=users[owner];
  form.set('meta',JSON.stringify({id,promptId:prompt.id,createdAt:'2026-01-01T00:00:00.000Z',duration:4,note:'fixture',...extra}));
  form.set('audio',new File([bytes],'fixture.webm',{type:'audio/webm'}));
  return e.call('recordings','POST',{cookie:user.cookie,owner:headers['x-lantern-owner']??user.id,body:form,headers});
 }
 return {...e,users,calls,hooks,prompt,upload,get:(owner,id)=>e.call('recordings','GET',{cookie:users[owner].cookie,query:'?id='+id}),rows:()=>e.rows('recordings')};
}
module.exports={environment};
