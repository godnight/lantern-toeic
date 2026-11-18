import { Buffer } from 'node:buffer';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export type UsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: 'invalid-username' };

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; error: 'invalid-password' };

// Only the server may use this module. Usernames are credentials, never data owners.
export function normalizeUsername(input: unknown): UsernameResult {
  // Reject Unicode confusables and hidden Unicode characters before trimming.
  if (typeof input !== 'string' || /[^\x00-\x7f]/.test(input)) {
    return { ok: false, error: 'invalid-username' };
  }
  const username = input.trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return { ok: false, error: 'invalid-username' };
  }
  return { ok: true, username: username.toLowerCase() };
}

export function validatePassword(input: unknown): PasswordValidationResult {
  if (typeof input !== 'string' || input.length > 256 || input.includes('\0')) {
    return { ok: false, error: 'invalid-password' };
  }
  const points = [...input].length;
  const bytes = Buffer.from(input, 'utf8');
  // Reject ill-formed UTF-16 rather than silently encoding it as a replacement
  // character, which could make two different input strings the same password.
  if (points < 8 || points > 128 || bytes.length > 512 || bytes.toString('utf8') !== input) {
    return { ok: false, error: 'invalid-password' };
  }
  return { ok: true };
}

// OWASP's supported 16 MiB configuration. Parameters are not read from storage:
// a damaged/adversarial hash must not select weaker settings or consume huge RAM.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 });
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const HASH_PREFIX = '$lantern$scrypt$v=1$n=16384,r=8,p=5,k=64$';
const HASH_PATTERN = /^\$lantern\$scrypt\$v=1\$n=16384,r=8,p=5,k=64\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

export const PASSWORD_HASH_CONCURRENCY = 1;

export class PasswordHashBusyError extends Error {
  constructor() {
    super('Password hashing temporarily unavailable');
    this.name = 'PasswordHashBusyError';
  }
}

// One slot per module/isolate, shared by registration and verification. There is
// deliberately no waiting queue: callers must apply backpressure at the boundary.
let activeDerivations = 0;
type Derive = (password: string, salt: Buffer) => Promise<Buffer>;
type ReservedPasswordHasher = {
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: unknown, encodedHash: unknown) => Promise<boolean>;
};

async function hashWith(derive: Derive, password: string): Promise<string> {
  if (!validatePassword(password).ok) throw new Error('Invalid password');
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${HASH_PREFIX}${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyWith(derive: Derive, password: unknown, encodedHash: unknown): Promise<boolean> {
  if (!validatePassword(password).ok || typeof password !== 'string' || typeof encodedHash !== 'string') {
    return false;
  }
  // Exact length bounds work before regex/decoding even for untrusted storage.
  if (encodedHash.length !== HASH_PREFIX.length + SALT_BYTES * 2 + 1 + KEY_BYTES * 2) {
    return false;
  }
  const parsed = HASH_PATTERN.exec(encodedHash);
  if (!parsed) return false;
  const expected = Buffer.from(parsed[2], 'hex');
  const actual = await derive(password, Buffer.from(parsed[1], 'hex'));
  return timingSafeEqual(actual, expected);
}

/** Reserve the same no-queue KDF slot before admission can spend a shared
 * database budget. The callback may perform at most one derivation; an escaped
 * callback cannot use the slot after it is released. */
export async function withPasswordHashSlot<T>(action: (hasher: ReservedPasswordHasher) => Promise<T>): Promise<T> {
  if (activeDerivations >= PASSWORD_HASH_CONCURRENCY) throw new PasswordHashBusyError();
  activeDerivations++;
  let used = false, closed = false, pending: Promise<Buffer> | undefined;
  const derive: Derive = (password, salt) => {
    if (used || closed) throw new Error('Password hash slot is no longer available');
    used = true;
    pending = new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
    return pending;
  };
  try {
    return await action(Object.freeze({
      hashPassword: (password: string) => hashWith(derive, password),
      verifyPassword: (password: unknown, encodedHash: unknown) => verifyWith(derive, password, encodedHash),
    }));
  } finally {
    closed = true;
    // An escaped or unawaited callback must never release the slot before the
    // underlying crypto work actually completes, including synchronous errors.
    if (pending) await pending.catch(() => {});
    activeDerivations--;
  }
}

/** Hash exactly the supplied password; never trim, normalize, truncate or log it. */
export async function hashPassword(password: string): Promise<string> {
  if (!validatePassword(password).ok) throw new Error('Invalid password');
  return withPasswordHashSlot(hasher => hasher.hashPassword(password));
}

/** Unsupported/corrupt stored formats fail closed; runtime crypto errors propagate. */
export async function verifyPassword(password: unknown, encodedHash: unknown): Promise<boolean> {
  if (!validatePassword(password).ok || typeof password !== 'string' || typeof encodedHash !== 'string' ||
      encodedHash.length !== HASH_PREFIX.length + SALT_BYTES * 2 + 1 + KEY_BYTES * 2 || !HASH_PATTERN.test(encodedHash)) return false;
  return withPasswordHashSlot(hasher => hasher.verifyPassword(password, encodedHash));
}
