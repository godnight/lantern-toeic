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
  if (points < 15 || points > 128 || bytes.length > 512 || bytes.toString('utf8') !== input) {
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

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeDerivations >= PASSWORD_HASH_CONCURRENCY) throw new PasswordHashBusyError();
  activeDerivations++;
  try {
    // Keep the slot until the actual crypto callback resolves/rejects. A timeout
    // race must not free it while expensive work is still running underneath.
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
  } finally {
    // Also runs if scrypt throws synchronously inside the Promise executor.
    activeDerivations--;
  }
}

/** Hash exactly the supplied password; never trim, normalize, truncate or log it. */
export async function hashPassword(password: string): Promise<string> {
  if (!validatePassword(password).ok) throw new Error('Invalid password');
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${HASH_PREFIX}${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Unsupported/corrupt stored formats fail closed; runtime crypto errors propagate. */
export async function verifyPassword(password: unknown, encodedHash: unknown): Promise<boolean> {
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
