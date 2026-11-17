'use client';

import {useEffect, useRef, useState} from 'react';
import {FIRST_RUN_STORAGE_KEY, FirstRunError, inspectFirstRun, persistFirstRunCompletion} from './first-run';

export type FirstRunStatus = 'checking' | 'welcome' | 'complete' | 'error';
export type FirstRunController = Readonly<{
  status: FirstRunStatus;
  error: string;
  complete: (reason?: 'guest-entered' | 'verified-account') => boolean;
  retry: () => void;
}>;
type Snapshot = {owner: string | null; status: FirstRunStatus; error: string};
const message = (error: unknown) => error instanceof FirstRunError
  ? error.message : '首次使用记录暂时不可用。原学习记录未更改，请重试。';

export function useFirstRun(identityReady: boolean, owner: string | null): FirstRunController {
  const [snapshot, setSnapshot] = useState<Snapshot>({owner, status: 'checking', error: ''});
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const identity = useRef({ready: identityReady, owner});
  identity.current = {ready: identityReady, owner};
  const status = !identityReady || snapshot.owner !== owner ? 'checking' : snapshot.status;
  const current = useRef({status, owner});
  current.current = {status, owner};

  useEffect(() => {
    const id = ++generation.current;
    const controller = new AbortController();
    const active = () => generation.current === id && identity.current.ready && identity.current.owner === owner;
    if (!identityReady) {
      setSnapshot({owner, status: 'checking', error: ''});
      return () => { controller.abort(); if (generation.current === id) generation.current++; };
    }
    setSnapshot({owner, status: 'checking', error: ''});
    void (async () => {
      try {
        const storage = window.localStorage;
        const result = await inspectFirstRun(storage, owner, typeof indexedDB === 'undefined' ? undefined : indexedDB, {signal: controller.signal});
        if (!active()) return;
        if (result.status === 'complete' && !result.persisted) persistFirstRunCompletion(storage, result.reason);
        if (active()) setSnapshot({owner, status: result.status, error: ''});
      } catch (error) {
        if (active()) setSnapshot({owner, status: 'error', error: message(error)});
      }
    })();
    return () => { controller.abort(); if (generation.current === id) generation.current++; };
  }, [identityReady, owner, attempt]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === FIRST_RUN_STORAGE_KEY || event.key === null) setAttempt(value => value + 1);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  function complete(reason: 'guest-entered' | 'verified-account' = owner === null ? 'guest-entered' : 'verified-account'): boolean {
    if (!identity.current.ready || current.current.owner !== identity.current.owner ||
      !['welcome', 'complete'].includes(current.current.status) || reason === 'verified-account' && identity.current.owner === null) return false;
    ++generation.current;
    try {
      persistFirstRunCompletion(window.localStorage, reason);
      setSnapshot({owner: identity.current.owner, status: 'complete', error: ''});
      return true;
    } catch (error) {
      setSnapshot({owner: identity.current.owner, status: 'error', error: message(error)});
      return false;
    }
  }
  return {status, error: status === 'error' ? snapshot.error : '', complete, retry: () => setAttempt(value => value + 1)};
}
