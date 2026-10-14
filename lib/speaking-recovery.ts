import type {Recording, Speaking} from './study-model';

/** Page-memory recovery only; never written to another account or a database. */
export type SpeakingRecovery = {prompt: Speaking; meta: Recording; blob: Blob; saving?: Promise<void>;processing?:boolean};
const clips = new Map<string, SpeakingRecovery>();
const listeners = new Map<string, Set<() => void>>();
export function getSpeakingRecovery(scope: string): SpeakingRecovery | undefined {return clips.get(scope);}
export function hasSpeakingRecovery(): boolean {return clips.size>0;}
export function retainSpeakingRecovery(scope: string, clip: SpeakingRecovery): void {
  clips.set(scope, clip);listeners.get(scope)?.forEach(fn => fn());
}
export function releaseSpeakingRecovery(scope: string, id: string): void {
  if(clips.get(scope)?.meta.id !== id)return;
  clips.delete(scope);listeners.get(scope)?.forEach(fn => fn());
}
export function subscribeSpeakingRecovery(scope: string, fn: () => void): () => void {
  if(!listeners.has(scope))listeners.set(scope, new Set());
  listeners.get(scope)!.add(fn);
  return () => {listeners.get(scope)?.delete(fn);if(!listeners.get(scope)?.size)listeners.delete(scope);};
}
