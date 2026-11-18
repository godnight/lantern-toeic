// Server-side candidate, not enabled by any route. getCredentials and
// makeProvider must be trusted, preflight-only server functions: they MUST NOT
// send a message or perform a verification. No network/default credentials are
// read here. Once provider.send is invoked, any failure is ambiguous and must
// propagate; never convert it to a definite rejection or automatically retry.
export function createPreflightProvider({getCredentials,makeProvider}={}) {
 if(typeof getCredentials!=='function'||typeof makeProvider!=='function')throw Error('phone provider unavailable');
 async function prepare(signal){
  if(!signal||typeof signal.aborted!=='boolean'||signal.aborted)throw Error('phone preflight unavailable');
  const credentials=await getCredentials();
  if(signal.aborted)throw Error('phone preflight unavailable');
  const provider=makeProvider(credentials);
  if(!provider||typeof provider.send!=='function'||typeof provider.verify!=='function')throw Error('phone preflight unavailable');
  if(signal.aborted)throw Error('phone preflight unavailable');
  return provider;
 }
 return {
  async send(context,key,signal){
   let provider;
   try{provider=await prepare(signal);}catch{return {status:'rejected'};}
   // prepare() performed no SMS call. From this point forward an exception
   // could mean accepted-but-unacknowledged: never retry or mark rejected.
   return provider.send(context,key,signal);
  },
  async verify(input,context,signal){
   let provider;try{provider=await prepare(signal);}catch{throw Error('phone verification unavailable');}
   return provider.verify(input,context,signal);
  },
 };
}
