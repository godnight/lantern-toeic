// Isolated design candidate. The caller must explicitly inject metadata and
// PNVS transports; this module never discovers or contacts the real network.
const METADATA = 'http://100.100.100.200';
const MAX_RESPONSE = 16384;

async function readLimited(response, max) {
  if (!response?.ok || !response.body) throw new Error('metadata unavailable');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error('metadata unavailable'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', {fatal:true}).decode(bytes);
}

export function createEcsRoleCredentials({roleName, metadataFetch, now=Date.now, refreshBeforeMs=300000, timeoutMs=2000} = {}) {
  if (typeof metadataFetch !== 'function' || typeof now !== 'function' || !/^[A-Za-z0-9._-]{1,64}$/.test(roleName || '') || roleName==='.' || roleName==='..' ||
      !Number.isSafeInteger(refreshBeforeMs) || refreshBeforeMs < 60000 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw new Error('credential provider configuration unavailable');
  let cached = null, inFlight = null;

  async function fetchText(url, init, max) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async()=>readLimited(await metadataFetch(url,{...init,signal:controller.signal,redirect:'error'}),max))(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('metadata unavailable'));},timeoutMs);}),
      ]);
    } catch { throw new Error('metadata unavailable'); }
    finally { clearTimeout(timer); }
  }

  async function refresh() {
    const token=await fetchText(METADATA+'/latest/api/token',{
      method:'PUT',headers:{'X-aliyun-ecs-metadata-token-ttl-seconds':'60'},
    },4096);
    if (!/^[\x21-\x7e]{1,4096}$/.test(token)) throw new Error('metadata unavailable');
    const text=await fetchText(METADATA+'/latest/meta-data/ram/security-credentials/'+encodeURIComponent(roleName),{
      method:'GET',headers:{'X-aliyun-ecs-metadata-token':token},
    },MAX_RESPONSE);
    let data; try { data=JSON.parse(text); } catch { throw new Error('metadata unavailable'); }
    const validText=value=>typeof value==='string' && /^[\x21-\x7e]{1,8192}$/.test(value);
    const expiration=Date.parse(data?.Expiration);
    if (data?.Code!=='Success' || !validText(data.AccessKeyId) || !validText(data.AccessKeySecret) ||
        !validText(data.SecurityToken) || !Number.isFinite(expiration) || expiration-now()<=refreshBeforeMs)
      throw new Error('metadata unavailable');
    return Object.freeze({accessKeyId:data.AccessKeyId,accessKeySecret:data.AccessKeySecret,securityToken:data.SecurityToken,expiration});
  }

  return async function getCredentials() {
    if (cached && cached.expiration-now()>refreshBeforeMs) return cached;
    if (!inFlight) inFlight=refresh().then(value=>{cached=value;return value;}).catch(()=>{cached=null;throw new Error('metadata unavailable');}).finally(()=>{inFlight=null;});
    return inFlight;
  };
}

export function createRefreshingPnvsClient({getCredentials,makeClient,pnvsFetch} = {}) {
  if (typeof getCredentials !== 'function' || typeof makeClient !== 'function' || typeof pnvsFetch !== 'function')
    throw new Error('PNVS client configuration unavailable');
  return {async call(action,fields,signal) {
    if (!signal || signal.aborted) throw new Error('PNVS request unavailable');
    let credentials;
    try { credentials=await getCredentials(); } catch { throw new Error('PNVS request unavailable'); }
    if (signal.aborted) throw new Error('PNVS request unavailable');
    return makeClient(credentials,pnvsFetch).call(action,fields,signal);
  }};
}
