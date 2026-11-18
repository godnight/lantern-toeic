/**
 * Server-only boundary. Import from an authenticated server route, never a client
 * bundle. Provider/store/audience are operator-owned dependencies, not request
 * fields. This module sends no SMS and implements neither passwords nor sessions.
 */
export const PHONE_PROOF_MAX_LIFETIME_MS = 5 * 60 * 1000;
export const PHONE_PROOF_FUTURE_SKEW_MS = 5 * 1000;
export const PHONE_CREDENTIAL_MAX_LENGTH = 4096;

export type PhoneExpectation =
  | Readonly<{ purpose: 'bind'; phone: string; bindingUserId: string }>
  | Readonly<{ purpose: 'login'; phone: string; bindingUserId?: never }>;

export interface PhoneProviderExpectation {
  readonly purpose: 'bind' | 'login';
  readonly audience: string;
  readonly phone: string;
  readonly bindingUserId: string | null;
}

export interface PhoneProviderAssertion extends PhoneProviderExpectation {
  /** Random >=128-bit identifier, stable across retries of one credential. */
  readonly proofId: string;
  /** Unix epoch milliseconds; never seconds. */
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface PhoneVerificationProvider {
  /**
   * Trusted server adapter validates the opaque credential with its real issuer.
   * It must enforce challenge attempt/rate limits and context binding, never
   * interpret a caller-supplied phone as ownership. A failed credential is null;
   * provider/network failure throws. Do not mint a fresh proofId on each retry.
   * The wrapper still validates every returned field at runtime.
   */
  verify(
    opaqueCredential: string,
    expected: Readonly<PhoneProviderExpectation>,
  ): Promise<PhoneProviderAssertion | null>;
}

export interface VerifiedPhoneCommand extends PhoneProviderAssertion {
  readonly providerId: string;
  readonly verifiedAt: number;
}

export type PhoneCommitResult =
  | Readonly<{ status: 'committed'; userId: string }>
  | Readonly<{
      status: 'replayed' | 'binding-conflict' | 'not-bound' | 'unauthorized' | 'expired';
    }>;

export interface PhoneTransactionStore {
  /**
   * REQUIRED atomic contract, including concurrent requests/workers:
   *
   * - Recheck expiry with server time at commit, then claim the unique
   *   (providerId, proofId). Keep the claim until at least expiresAt plus skew.
   * - bind: resolve/recheck the ACTIVE existing server session in this same
   *   transaction; it must equal bindingUserId. A request-scoped store closes
   *   over the actual authenticated session, never a client userId/owner header.
   *   userId must already exist. Enforce UNIQUE(phone), and at most one phone per
   *   user in this bounded version. Same phone/same user may commit idempotently;
   *   no transfer, replacement, account creation, merge or old-data claim.
   * - login: resolve phone -> an EXISTING stable user_id, then commit through the
   *   existing session issuer/revocation policy in the SAME transaction as the
   *   proof claim. It must not return success after just a binding lookup. This
   *   module does not issue tokens or define a replacement session scheme.
   * - Known SQL rejection rolls back proof, binding AND session writes. Lost
   *   commit acknowledgements require read-only ticket reconciliation; if that
   *   is unavailable, report unavailable, never assert that rollback occurred.
   *   All unique/conflict/zero-change outcomes must be checked explicitly; a
   *   SQL statement that changes zero rows is not automatically a rollback.
   *
   * Real adapters and in-memory behavior tests must preserve this contract;
   * local D1 tests still do not establish deployed or cross-region behavior.
   */
  commitVerifiedPhone(command: Readonly<VerifiedPhoneCommand>): Promise<PhoneCommitResult>;
}

export interface PhoneBoundaryConfig {
  readonly provider?: PhoneVerificationProvider;
  readonly providerId?: string;
  /** Exact operator-owned audience, separate from any client request field. */
  readonly audience?: string;
  readonly store?: PhoneTransactionStore;
  /** Server clock injection for deterministic tests; never supplied by clients. */
  readonly now?: () => number;
}

export type PhoneVerificationError =
  | 'unavailable' | 'invalid-request' | 'invalid-proof' | 'replayed'
  | 'binding-conflict' | 'not-bound' | 'unauthorized';

export type PhoneVerificationResult =
  | Readonly<{ ok: true; purpose: 'bind' | 'login'; phone: string; userId: string }>
  | Readonly<{ ok: false; error: PhoneVerificationError }>;

export interface PhoneVerificationBoundary {
  readonly available: boolean;
  verifyAndCommit(expected: PhoneExpectation, opaqueCredential: unknown): Promise<PhoneVerificationResult>;
}

const stableUserId = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonicalPhone = /^\+861[0-9]{10}$/;
const proofId = /^[A-Za-z0-9_-]{22,128}$/;
const providerIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function fail(error: PhoneVerificationError): PhoneVerificationResult {
  return { ok: false, error };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function epoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTime(issuedAt: number, expiresAt: number, now: number): boolean {
  return epoch(issuedAt) && epoch(expiresAt) && epoch(now)
    && issuedAt < expiresAt
    && expiresAt - issuedAt <= PHONE_PROOF_MAX_LIFETIME_MS
    && issuedAt <= now + PHONE_PROOF_FUTURE_SKEW_MS
    && now - issuedAt <= PHONE_PROOF_MAX_LIFETIME_MS
    && now < expiresAt;
}

function expectation(value: unknown, audience: string): Readonly<PhoneProviderExpectation> | null {
  const candidate = record(value);
  if (!candidate) return null;
  const { phone, purpose, bindingUserId } = candidate;
  if (typeof phone !== 'string' || !canonicalPhone.test(phone)) return null;
  if (purpose === 'bind' && typeof bindingUserId === 'string' && stableUserId.test(bindingUserId)) {
    return Object.freeze({ purpose: 'bind', audience, phone, bindingUserId });
  }
  if (purpose === 'login' && bindingUserId === undefined) {
    return Object.freeze({ purpose: 'login', audience, phone, bindingUserId: null });
  }
  return null;
}

function assertion(value: unknown, expected: Readonly<PhoneProviderExpectation>, now: number): PhoneProviderAssertion | null {
  const candidate = record(value);
  if (!candidate) return null;
  const { purpose, audience, phone, bindingUserId, proofId: identifier, issuedAt, expiresAt } = candidate;
  if (purpose !== expected.purpose || audience !== expected.audience
    || phone !== expected.phone || bindingUserId !== expected.bindingUserId
    || typeof identifier !== 'string' || !proofId.test(identifier)
    || !epoch(issuedAt) || !epoch(expiresAt) || !validTime(issuedAt, expiresAt, now)) {
    return null;
  }
  // Copy only checked primitives. Neither extra provider fields nor credentials
  // pass through to the transaction store or browser response.
  return Object.freeze({ ...expected, proofId: identifier, issuedAt, expiresAt });
}

export function createPhoneVerificationBoundary(config: PhoneBoundaryConfig): PhoneVerificationBoundary {
  const { provider, store, providerId: issuer, audience, now = Date.now } = config;
  const available = Boolean(provider && typeof provider.verify === 'function'
    && store && typeof store.commitVerifiedPhone === 'function'
    && typeof issuer === 'string' && providerIdPattern.test(issuer)
    && typeof audience === 'string' && /^[\x21-\x7e]{1,256}$/.test(audience)
    && typeof now === 'function');

  return Object.freeze({
    available,
    async verifyAndCommit(input: PhoneExpectation, opaqueCredential: unknown): Promise<PhoneVerificationResult> {
      if (!available || !provider || !store || !issuer || !audience) return fail('unavailable');
      let expected: Readonly<PhoneProviderExpectation> | null;
      try { expected = expectation(input, audience); } catch { return fail('invalid-request'); }
      if (!expected || typeof opaqueCredential !== 'string' || opaqueCredential.length < 1
        || opaqueCredential.length > PHONE_CREDENTIAL_MAX_LENGTH || /[^\x21-\x7e]/.test(opaqueCredential)) {
        return fail('invalid-request');
      }
      let providerResult: unknown;
      try { providerResult = await provider.verify(opaqueCredential, expected); }
      catch { return fail('unavailable'); }
      let verified: PhoneProviderAssertion | null;
      let verifiedAt: number;
      try {
        verifiedAt = now();
        verified = assertion(providerResult, expected, verifiedAt);
      } catch { return fail('invalid-proof'); }
      if (!verified) return fail('invalid-proof');
      let result: PhoneCommitResult;
      try {
        result = await store.commitVerifiedPhone(Object.freeze({ ...verified, providerId: issuer, verifiedAt }));
      } catch { return fail('unavailable'); }
      try {
        const status = result.status;
        if (status === 'committed') {
          const userId = result.userId;
          if (typeof userId !== 'string' || !stableUserId.test(userId)
            || (expected.purpose === 'bind' && userId !== expected.bindingUserId)) {
            return fail('unavailable');
          }
          return { ok: true, purpose: expected.purpose, phone: expected.phone, userId };
        }
        if (status === 'expired') return fail('invalid-proof');
        if (status === 'replayed' || status === 'binding-conflict'
          || status === 'not-bound' || status === 'unauthorized') {
          return fail(status);
        }
      } catch { /* A malformed adapter result never becomes authenticated. */ }
      return fail('unavailable');
    },
  });
}
