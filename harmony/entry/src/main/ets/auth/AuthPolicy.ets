// Protocol parsing only. No credentials or system diagnostics may enter replies.
export interface AuthCredentials {
  username?: string;
  password?: string;
  purpose?: string;
  phone?: string;
  challengeId?: string;
  code?: string;
}
export interface AuthRequest {
  id: string;
  action: string;
  body?: AuthCredentials;
}
export interface AuthUser {
  id: string;
  username: string;
}
export interface AuthCapabilities {
  passwordLogin?: boolean;
  phoneLogin: boolean;
  phoneBinding?: boolean;
  cloudSync?: boolean;
  passwordRecovery?: boolean;
}
export interface AuthBody {
  code?: string;
  error?: string;
  user?: AuthUser;
  capabilities?: AuthCapabilities;
  ok?: boolean;
  phone?: string;
  purpose?: string;
  challengeId?: string;
  expiresAt?: string;
  resendAt?: string;
  retryAt?: string;
  attemptsRemaining?: number;
}
export interface AuthReply {
  id: string;
  status: number;
  body: AuthBody;
}
export interface AuthCookie {
  token: string;
  maxAge: number;
}
export interface AuthRoute {
  path: string;
  method: string;
}
export const COOKIE_NAME: string = '__Host-lantern-session';
export const AUTH_TIMEOUT_MS: number = 15000;
export const MAX_RESPONSE_BYTES: number = 16384;

export function utf8Length(value: string): number {
  let count: number = 0;
  for (let i: number = 0; i < value.length; i++) {
    const unit: number = value.charCodeAt(i);
    if (unit < 128) count++;
    else if (unit < 2048) count += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      count += 4;
      i++;
    } else count += 3;
  }
  return count;
}

export function trustedFrame(url: string): boolean {
  // Exact authority; reject credentials, alternate ports, opaque frames and suffix hosts.
  return /^https:\/\/lantern\.local\/(?:[^\\\r\n]*)$/.test(url);
}

export function configuredOrigin(origin: string): boolean {
  // A build-owned origin, never supplied by a JS request. No path/userinfo/query.
  return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/.test(origin) &&
    origin !== 'https://lantern.local';
}

export function phoneAction(action: string): boolean {
  return ['phone-status', 'phone-challenge', 'phone-bind', 'phone-login'].includes(action);
}

export function authRoute(action: string): AuthRoute | undefined {
  if (['session', 'register', 'login', 'logout'].includes(action)) {
    return { path: '/api/auth/' + action, method: action === 'session' ? 'GET' : 'POST' };
  }
  if (action === 'phone-status') return { path: '/api/auth/phone/status', method: 'GET' };
  if (action === 'phone-challenge') return { path: '/api/auth/phone/challenge', method: 'POST' };
  if (action === 'phone-bind') return { path: '/api/auth/phone/bind', method: 'POST' };
  if (action === 'phone-login') return { path: '/api/auth/phone/login', method: 'POST' };
  return undefined;
}

export function normalizedPhone(input: string): string | undefined {
  if (typeof input !== 'string' || input.length > 64 || /[^+0-9 -]/.test(input)) return undefined;
  const value: string = input.replace(/^ +| +$/g, '');
  if (!/^(?:\+86[ -]*)?1(?:[ -]*[0-9]){10}$/.test(value)) return undefined;
  return '+86' + value.replace(/[ -]/g, '').replace(/^\+86/, '');
}

export function isoTime(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  const time: number = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0 || new Date(time).toISOString() !== value) return undefined;
  return time;
}

export function parseAuthRequest(raw: string): AuthRequest | undefined {
  if (typeof raw !== 'string' || raw.length > 4096 || utf8Length(raw) > 4096) return undefined;
  try {
    const value: AuthRequest = JSON.parse(raw) as AuthRequest;
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id) ||
      typeof value.action !== 'string') return undefined;
    const keys: string = Object.keys(value).sort().join(',');
    if (keys !== 'action,id' && keys !== 'action,body,id') return undefined;
    if (value.action === 'session' || value.action === 'logout' || value.action === 'phone-status') {
      if (value.body !== undefined && (value.body === null || typeof value.body !== 'object' ||
        Array.isArray(value.body) || Object.keys(value.body).length !== 0)) return undefined;
      return value;
    }
    if (phoneAction(value.action)) {
      const body: AuthCredentials | undefined = value.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.phone !== 'string') return undefined;
      const phone: string | undefined = normalizedPhone(body.phone);
      if (phone === undefined) return undefined;
      const fields: string = Object.keys(body).sort().join(',');
      if (value.action === 'phone-challenge') {
        if (fields !== 'phone,purpose' || (body.purpose !== 'bind' && body.purpose !== 'login')) return undefined;
        return { id: value.id, action: value.action, body: { phone: phone, purpose: body.purpose } };
      }
      if (fields !== 'challengeId,code,phone' || typeof body.challengeId !== 'string' ||
        !/^[A-Za-z0-9_-]{32}$/.test(body.challengeId) || typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) return undefined;
      return { id: value.id, action: value.action, body: { challengeId: body.challengeId, phone: phone, code: body.code } };
    }
    if (value.action !== 'register' && value.action !== 'login') return undefined;
    const body: AuthCredentials | undefined = value.body;
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'password,username' ||
      typeof body.username !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(body.username.trim()) ||
      typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 256 ||
      utf8Length(JSON.stringify(body)) > 2048) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function capabilities(enabled: boolean): AuthCapabilities {
  return { passwordLogin: enabled, phoneLogin: false, cloudSync: false, passwordRecovery: false };
}

export function unavailableBody(): AuthBody {
  return { code: 'native-auth-unavailable', error: '此设备的网络账号服务尚未启用。', capabilities: { passwordLogin: false, phoneLogin: false, phoneBinding: false, cloudSync: false, passwordRecovery: false } };
}

export function unknownBody(): AuthBody {
  return { code: 'auth-state-unknown', error: '账号状态尚未确认，请重新核对。' };
}

export function phoneUnknownBody(): AuthBody {
  return { code: 'phone-state-unknown', error: '手机号请求状态尚未确认，请重新核对。' };
}

export function operationUnknownBody(action: string): AuthBody {
  return phoneAction(action) ? phoneUnknownBody() : unknownBody();
}

export function phoneStatus(body: AuthBody): AuthBody {
  if (typeof body.capabilities?.phoneLogin !== 'boolean' || typeof body.capabilities?.phoneBinding !== 'boolean') throw new Error('Unconfirmed');
  return { capabilities: { phoneLogin: body.capabilities.phoneLogin, phoneBinding: body.capabilities.phoneBinding } };
}

export function phoneSuccessCapabilities(body: AuthBody): AuthCapabilities {
  const out: AuthCapabilities = { passwordLogin: true, phoneLogin: body.capabilities?.phoneLogin === true, cloudSync: false, passwordRecovery: false };
  if (typeof body.capabilities?.phoneBinding === 'boolean') out.phoneBinding = body.capabilities.phoneBinding;
  return out;
}

export function phoneChallenge(body: AuthBody, input: AuthCredentials): AuthBody {
  const expiry: number | undefined = isoTime(body.expiresAt);
  const resend: number | undefined = isoTime(body.resendAt);
  const now: number = Date.now();
  if (typeof body.challengeId !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(body.challengeId) ||
    body.purpose !== input.purpose || body.phone !== input.phone || expiry === undefined || resend === undefined ||
    expiry <= now || resend < now || resend > expiry) throw new Error('Unconfirmed');
  return { challengeId: body.challengeId, expiresAt: body.expiresAt, resendAt: body.resendAt, purpose: body.purpose, phone: body.phone };
}

export function phoneFailure(status: number, body: AuthBody): AuthReply {
  if (status === 503 && body.code === 'phone-unavailable') {
    return { id: '', status: 503, body: { code: 'phone-unavailable', error: '手机号服务尚未启用。', capabilities: { passwordLogin: body.capabilities?.passwordLogin === true, phoneLogin: false, phoneBinding: false, cloudSync: false, passwordRecovery: false } } };
  }
  if (status === 401 && body.code === 'unauthenticated') return { id: '', status: 401, body: unauthenticatedBody() };
  const accepted: boolean = status === 400 && ['invalid-phone-request', 'phone-invalid-code', 'phone-not-bound'].includes(body.code || '') ||
    status === 410 && body.code === 'phone-expired' || status === 409 && ['phone-replayed', 'phone-binding-conflict'].includes(body.code || '') ||
    status === 429 && body.code === 'phone-rate-limited';
  if (!accepted) return { id: '', status: 503, body: phoneUnknownBody() };
  const projected: AuthBody = { code: body.code, error: '手机号请求未被接受，请检查后重试。' };
  if (body.attemptsRemaining !== undefined) {
    if (!Number.isInteger(body.attemptsRemaining) || body.attemptsRemaining < 0 || body.attemptsRemaining > 5) throw new Error('Unconfirmed');
    projected.attemptsRemaining = body.attemptsRemaining;
  }
  if (body.retryAt !== undefined) {
    if (isoTime(body.retryAt) === undefined) throw new Error('Unconfirmed');
    projected.retryAt = body.retryAt;
  }
  return { id: '', status: status, body: projected };
}

export function unauthenticatedBody(): AuthBody {
  return { code: 'unauthenticated', error: '当前没有经确认的登录会话。' };
}

export function publicUser(body: AuthBody): AuthUser | undefined {
  const user: AuthUser | undefined = body.user;
  if (!user || typeof user.id !== 'string' ||
    !/^usr_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user.id) ||
    typeof user.username !== 'string' || !/^[a-z0-9_]{3,32}$/.test(user.username)) return undefined;
  // Construct a fresh public object. Extra server fields never cross this boundary.
  return { id: user.id, username: user.username };
}

export function parseResponseBody(raw: string): AuthBody {
  if (typeof raw !== 'string' || utf8Length(raw) > MAX_RESPONSE_BYTES) throw new Error('Unconfirmed');
  const body: AuthBody = JSON.parse(raw) as AuthBody;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Unconfirmed');
  return body;
}

export function publicFailure(status: number, body: AuthBody): AuthReply {
  if (status === 503 && body.code === 'auth-disabled' && body.capabilities?.passwordLogin === false) {
    return { id: '', status: 503, body: { code: 'auth-disabled', capabilities: capabilities(false) } };
  }
  if (status === 401) return { id: '', status: 401, body: unauthenticatedBody() };
  if (status === 429) return { id: '', status: 429, body: { code: 'too-many-attempts', error: '尝试次数过多，请稍后重试。' } };
  if (status === 400 || status === 403 || status === 409 || status === 413) {
    return { id: '', status: status, body: { code: 'auth-request-rejected', error: '账号请求未被接受，请检查后重试。' } };
  }
  return { id: '', status: 503, body: unknownBody() };
}

export function sessionCookie(lines: string[]): AuthCookie | undefined {
  if (lines.length > 16) return undefined;
  let result: AuthCookie | undefined = undefined;
  for (const line of lines) {
    if (line.length > 4096 || /[\r\n,]/.test(line)) return undefined;
    const pieces: string[] = line.split(';').map((part: string) => part.trim());
    if (!pieces[0].startsWith(COOKIE_NAME + '=')) continue;
    if (result !== undefined) return undefined;
    const token: string = pieces[0].slice(COOKIE_NAME.length + 1);
    if (token !== '' && !/^[a-f0-9]{64}$/.test(token)) return undefined;
    let secure: boolean = false;
    let httpOnly: boolean = false;
    let path: boolean = false;
    let sameSite: boolean = false;
    let maxAge: number = -1;
    const names: string[] = [];
    for (let i: number = 1; i < pieces.length; i++) {
      const part: string = pieces[i];
      const equal: number = part.indexOf('=');
      const name: string = (equal < 0 ? part : part.slice(0, equal)).toLowerCase();
      const value: string = equal < 0 ? '' : part.slice(equal + 1);
      if (names.includes(name)) return undefined;
      names.push(name);
      if (name === 'secure' && equal < 0) secure = true;
      else if (name === 'httponly' && equal < 0) httpOnly = true;
      else if (name === 'path' && value === '/') path = true;
      else if (name === 'samesite' && value.toLowerCase() === 'strict') sameSite = true;
      else if (name === 'max-age' && /^(0|[1-9][0-9]{0,4})$/.test(value)) maxAge = Number(value);
      else return undefined; // Includes Domain, Expires, duplicate or unknown attributes.
    }
    if (!secure || !httpOnly || !path || !sameSite || maxAge < 0 || maxAge > 43200 ||
      (token === '' ? maxAge !== 0 : maxAge === 0)) return undefined;
    result = { token: token, maxAge: maxAge };
  }
  return result;
}
