import {canonicalHash,canonicalJson} from './domain-command';
import type {Question} from './study-model';

/** These catalogues must come from the server's independently trusted and
 * admitted sources. Request bodies or remote client manifests are not an
 * authority. The digest verifies identity, not the source's authenticity. */
export type TrustedPracticeGradingCatalog=Readonly<{
  catalogVersion:string;
  questions:readonly Question[];
}>;
export type VersionedPracticeGrade=Readonly<{
  catalogVersion:string;
  qid:string;
  choice:number;
  correct:boolean;
}>;

type Answer=Readonly<{options:number;correctIndex:number}>;
const versionPattern=/^practice-v1:[a-f0-9]{64}$/;
function fail(reason:string):never{throw new Error('versioned-practice-'+reason);}
function plain(value:unknown):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===null||prototype===Object.prototype;
}
function validId(id:unknown):id is string{
  return typeof id==='string'&&id.length<=100&&id.trim()===id&&!!id&& !/[\u0000-\u001f\u007f]/.test(id);
}

/** Prepare an isolated, immutable server-side index of admitted versions.
 * A new publication must create a new index retaining every version needed
 * by existing sessions. This function is intentionally not an HTTP endpoint:
 * authentication, owner checks, storage, replay handling and deployment are
 * the caller's responsibility and are not implemented by this module. */
export function createVersionedPracticeGrader(catalogs:readonly TrustedPracticeGradingCatalog[]){
  if(!Array.isArray(catalogs)||catalogs.length<1)fail('catalogs');
  const versions=new Map<string,Map<string,Answer>>();
  const contentById=new Map<string,string>();
  for(const catalog of catalogs){
    if(!plain(catalog))fail('catalog');
    // Require exactly two own, enumerable data properties before serializing.
    // In particular, never evaluate a wrapper getter to obtain the authority.
    const wrapperKeys=Reflect.ownKeys(catalog);
    if(wrapperKeys.length!==2||!wrapperKeys.every(key=>typeof key==='string'&&['catalogVersion','questions'].includes(key)))fail('catalog');
    for(const key of ['catalogVersion','questions']){
      const descriptor=Object.getOwnPropertyDescriptor(catalog,key);
      if(!descriptor||!descriptor.enumerable||!('value'in descriptor))fail('catalog');
    }
    // Snapshot the complete wrapper once, then use only the detached values.
    // Even a caller whose property access changes over time cannot make the
    // checked version differ from the version used as the map key.
    const snapshot:unknown=JSON.parse(canonicalJson(catalog));
    if(!plain(snapshot)||Object.keys(snapshot).sort().join(',')!=='catalogVersion,questions'||
      typeof snapshot.catalogVersion!=='string'||!versionPattern.test(snapshot.catalogVersion)||
      versions.has(snapshot.catalogVersion)||!Array.isArray(snapshot.questions)||snapshot.questions.length<1)fail('catalog');
    const catalogVersion=snapshot.catalogVersion,rows=snapshot.questions as Question[];
    const serialized=canonicalJson(rows);
    if('practice-v1:'+canonicalHash(serialized)!==catalogVersion)fail('catalog-digest');
    const questions=new Map<string,Answer>();
    for(const question of rows){
      if(!plain(question)||!validId(question.id)||questions.has(question.id)||!Array.isArray(question.options)||
        question.options.length<2||question.options.length>4||
        question.options.some(option=>typeof option!=='string'||!option.trim())||
        new Set(question.options.map(option=>option.trim().toLowerCase())).size!==question.options.length||
        !Number.isInteger(question.correctIndex)||question.correctIndex<0||question.correctIndex>=question.options.length)fail('question');
      const serializedQuestion=canonicalJson(question),previous=contentById.get(question.id);
      if(previous!==undefined&&previous!==serializedQuestion)fail('question-id-reused');
      contentById.set(question.id,serializedQuestion);
      questions.set(question.id,Object.freeze({options:question.options.length,correctIndex:question.correctIndex}));
    }
    versions.set(catalogVersion,questions);
  }
  return Object.freeze({
    /** Strict wire shape: no client-provided correctness or other fields. */
    grade(input:unknown):VersionedPracticeGrade{
      if(!plain(input))fail('request');
      // Reject accessors/symbols and detach the request before inspecting it.
      const request:unknown=JSON.parse(canonicalJson(input));
      if(!plain(request)||Object.keys(request).sort().join(',')!=='catalogVersion,choice,qid'||
        typeof request.catalogVersion!=='string'||!versionPattern.test(request.catalogVersion)||
        !validId(request.qid)||!Number.isSafeInteger(request.choice))fail('request');
      const catalog=versions.get(request.catalogVersion);if(!catalog)fail('unknown-catalog');
      const answer=catalog.get(request.qid);if(!answer)fail('unknown-question');
      const choice=request.choice as number;
      if(choice<0||choice>=answer.options)fail('choice');
      return Object.freeze({catalogVersion:request.catalogVersion,qid:request.qid,choice,correct:choice===answer.correctIndex});
    }
  });
}
