'use strict';

// TEST ONLY. Never import from lib/, app/, routes, or any product bundle.
const { randomBytes, randomInt } = require('node:crypto');

function createSyntheticPhoneProvider({ now, maxAttempts = 3, lifetimeMs = 60_000 }) {
  const challenges = new Map();
  const assertions = new Map();
  let verifyCalls = 0;
  return {
    issueChallenge(context) {
      const challengeId = randomBytes(24).toString('base64url');
      challenges.set(challengeId, {
        context: { ...context, bindingUserId: context.bindingUserId ?? null },
        code: String(randomInt(100_000, 1_000_000)), attempts: 0,
        expiresAt: now() + lifetimeMs, redeemed: false,
      });
      // Simulated UI sees only a challenge ID, never a code or assertion.
      return { challengeId };
    },
    readOutOfBandCode(challengeId) {
      // Test harness channel only; no HTTP endpoint/flag exposes this method.
      return challenges.get(challengeId)?.code;
    },
    redeemChallenge({ challengeId, code, ...context }) {
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.redeemed || now() >= challenge.expiresAt
        || challenge.attempts >= maxAttempts) return null;
      challenge.attempts += 1;
      const expected = challenge.context;
      if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || code !== challenge.code
        || context.phone !== expected.phone || context.purpose !== expected.purpose
        || context.audience !== expected.audience
        || (context.bindingUserId ?? null) !== expected.bindingUserId) return null;
      const opaqueCredential = randomBytes(32).toString('base64url');
      assertions.set(opaqueCredential, Object.freeze({
        ...expected, proofId: randomBytes(32).toString('base64url'),
        issuedAt: now(), expiresAt: challenge.expiresAt,
      }));
      challenge.redeemed = true;
      return opaqueCredential;
    },
    provider: {
      async verify(opaqueCredential, expected) {
        verifyCalls += 1;
        const value = assertions.get(opaqueCredential);
        if (!value || now() >= value.expiresAt || value.purpose !== expected.purpose
          || value.audience !== expected.audience || value.phone !== expected.phone
          || value.bindingUserId !== expected.bindingUserId) return null;
        return { ...value };
      },
    },
    calls() { return verifyCalls; },
  };
}

function createSyntheticTransactionStore({ now, users, activeUsers = users, bindings = [], beforeCommit }) {
  const knownUsers = new Set(users);
  const active = new Set(activeUsers);
  let phones = new Map(bindings);
  let userPhones = new Map(bindings.map(([phone, userId]) => [userId, phone]));
  let consumed = new Map();
  let sessions = [];
  let tail = Promise.resolve();
  let failNext = false;
  let attempts = 0;

  async function transaction(command) {
    attempts += 1;
    if (beforeCommit) await beforeCommit();
    if (now() >= command.expiresAt) return { status: 'expired' };
    const key = command.providerId + ':' + command.proofId;
    if (consumed.has(key)) return { status: 'replayed' };
    const nextPhones = new Map(phones);
    const nextUserPhones = new Map(userPhones);
    const nextConsumed = new Map(consumed);
    const nextSessions = [...sessions];
    let userId;
    if (command.purpose === 'bind') {
      userId = command.bindingUserId;
      if (!knownUsers.has(userId) || !active.has(userId)) return { status: 'unauthorized' };
      if ((nextPhones.has(command.phone) && nextPhones.get(command.phone) !== userId)
        || (nextUserPhones.has(userId) && nextUserPhones.get(userId) !== command.phone)) {
        return { status: 'binding-conflict' };
      }
      nextPhones.set(command.phone, userId);
      nextUserPhones.set(userId, command.phone);
    } else {
      userId = nextPhones.get(command.phone);
      if (!userId || !knownUsers.has(userId)) return { status: 'not-bound' };
      // Synthetic marker ONLY. A production adapter must call the existing
      // session issuer/revocation policy in this atomic transaction.
      nextSessions.push(userId);
    }
    nextConsumed.set(key, command.expiresAt);
    if (failNext) {
      failNext = false;
      throw new Error('Synthetic transaction failure before commit');
    }
    phones = nextPhones;
    userPhones = nextUserPhones;
    consumed = nextConsumed;
    sessions = nextSessions;
    return { status: 'committed', userId };
  }

  return {
    store: {
      commitVerifiedPhone(command) {
        const pending = tail.then(() => transaction(command));
        tail = pending.then(() => undefined, () => undefined);
        return pending;
      },
    },
    failNextCommit() { failNext = true; },
    setSessionActive(userId, enabled) { enabled ? active.add(userId) : active.delete(userId); },
    snapshot() {
      return { phones: new Map(phones), consumed: consumed.size, sessions: [...sessions], attempts };
    },
  };
}

module.exports = { createSyntheticPhoneProvider, createSyntheticTransactionStore };
