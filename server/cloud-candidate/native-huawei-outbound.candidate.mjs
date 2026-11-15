// Only the two exact HTTPS endpoints used by the audited Huawei service.
// Secrets are passed in the provider POST only; no diagnostic output.
const TOKEN = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const INFO = 'https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo';
export function createNativeHuaweiOutbound({ enabled = false, clientId, fetchImpl = globalThis.fetch } = {}) {
  if (enabled !== true || typeof clientId !== 'string' || !/^\d{1,64}$/.test(clientId) || typeof fetchImpl !== 'function') throw Error('Huawei outbound disabled');
  return async (url, init) => {
    const fail = () => { throw Error('Huawei outbound rejected'); };
    if ((url !== TOKEN && url !== INFO) || !init || init.method !== 'POST' || init.redirect !== 'manual' || !(init.body instanceof URLSearchParams)) return fail();
    const headers = new Headers(init.headers);
    if (Array.from(headers.keys()).join(',') !== 'content-type' || headers.get('content-type') !== 'application/x-www-form-urlencoded') return fail();
    const keys = [...init.body.keys()].sort().join(',');
    if (url === TOKEN ? keys !== 'client_id,client_secret,code,grant_type,supportAlg' || init.body.get('client_id') !== clientId || init.body.get('grant_type') !== 'authorization_code' || init.body.get('supportAlg') !== 'PS256' : keys !== 'access_token,open_id' || init.body.get('open_id') !== 'OPENID') return fail();
    if ([...init.body.values()].some(value => !value || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value))) return fail();
    return fetchImpl(url, { method: 'POST', redirect: 'manual', signal: init.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(init.body) });
  };
}
