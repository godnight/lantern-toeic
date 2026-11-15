// Local coordination capability, not proof of identity or a server session.
const sessions = new WeakMap();
export function createNativeCandidateSession(owner) {
  const controller = new AbortController();
  const lease = Object.freeze({owner,signal:controller.signal,isCurrent:()=>!controller.signal.aborted});
  sessions.set(lease,controller);
  return lease;
}
export function revokeNativeCandidateSession(lease) {
  const controller=sessions.get(lease);
  if(!controller)throw Error('invalid local synchronization session');
  controller.abort();
}
