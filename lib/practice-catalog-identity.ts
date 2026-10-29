import {canonicalHash,canonicalJson} from './domain-command';
import type {Question} from './study-model';

const sealedVersions=new WeakMap<readonly Question[],string>();

/** Mutable caller catalogues still get a fresh full-content identity. */
export function practiceCatalogIdentity(questions:readonly Question[]):string {
 return sealedVersions.get(questions)??'practice-v1:'+canonicalHash(canonicalJson(JSON.parse(JSON.stringify(questions))));
}

function freezeJson(value:unknown,seen=new WeakSet<object>()) {
 if(value===null||typeof value!=='object'){
  if(value!==undefined&&!['string','number','boolean'].includes(typeof value))throw Error('question-catalog-not-immutable-json');
  return;
 }
 if(seen.has(value))return;
 seen.add(value);
 const prototype=Object.getPrototypeOf(value);
 if(!Array.isArray(value)&&prototype!==null&&(Object.prototype.toString.call(value)!=='[object Object]'||Object.getPrototypeOf(prototype)!==null))throw Error('question-catalog-not-immutable-json');
 if(Object.getOwnPropertySymbols(value).length)throw Error('question-catalog-not-immutable-json');
 for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))){
  if(!('value'in descriptor))throw Error('question-catalog-not-immutable-json');
  freezeJson(descriptor.value,seen);
 }
 Object.freeze(value);
}

/** Opt-in for bundled, pinned teaching data only. Deep immutability makes the
 * verified digest reusable without trusting an arbitrary array's identity. */
export function sealPracticeCatalog(questions:readonly Question[],expectedVersion:string):void {
 freezeJson(questions);
 const version=practiceCatalogIdentity(questions);
 if(version!==expectedVersion)throw Error('question-catalog-snapshot-mismatch');
 sealedVersions.set(questions,version);
}

/** One bundled catalogue is the bounded unit. Preserve the original complete
 * freeze/JSON-roundtrip/canonical/SHA path, then yield between catalogues.
 * Individual synchronous costs remain measured rather than hidden by async. */
export function* sealPracticeCatalogSteps(questions:readonly Question[],expectedVersion:string):Generator<void,void,void>{
 yield;
 sealPracticeCatalog(questions,expectedVersion);
 yield;
}
