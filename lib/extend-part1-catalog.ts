import {canonicalHash,canonicalJson} from './domain-command';
import {practiceCatalogIdentity,sealPracticeCatalog} from './practice-catalog-identity';
import type {QuestionCatalogSnapshot} from './question-catalog-admission';
import type {Part1TwelveAdmission} from './listening-part1-12-catalog';
import type {ReviewedListeningAudio} from './listening150-catalog';
import type {Question} from './study-model';

/** Imported from independently compiled, reviewed build inputs. These pins
 * must never be derived from the supplied batch or an untrusted download. */
export type Part1ExtensionPins=Readonly<{
  base313CanonicalSha256:string;
  combined325CanonicalSha256:string;
  audioBindingsCanonicalSha256:string;
}>;

const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=(value:unknown)=>canonicalHash(canonicalJson(value));
function fail(code:string):never{throw Error('part1-catalog-extension-'+code);}
function freezeJson<T>(value:T):T{
  if(value&&typeof value==='object'){for(const child of Object.values(value))freezeJson(child);Object.freeze(value);}
  return value;
}

/** Combines only already-admitted local content. This function does not
 * validate source rights, inspect image/audio bytes, or replace the separate
 * compiled-pin admission gate. Its pins must come from the trusted build, and
 * the caller must first run admitPart1TwelvePackage on that exact build. */
export function extendPart1Catalog(base:QuestionCatalogSnapshot,admitted:Part1TwelveAdmission,pins:Part1ExtensionPins){
  if(!pins||![pins.base313CanonicalSha256,pins.combined325CanonicalSha256,pins.audioBindingsCanonicalSha256].every(hex))fail('pins');
  const old=base.BASE_QUESTIONS,oldVersion='practice-v1:'+pins.base313CanonicalSha256;
  if(!Array.isArray(old)||old.length!==313||old!==base.QUESTIONS||!Object.isFrozen(old)||
    old.some(q=>!Object.isFrozen(q)||!Object.isFrozen(q.options))||
    base.QUESTION_CATALOG_VERSIONS.listening200_313!==oldVersion||practiceCatalogIdentity(old)!==oldVersion||
    !base.PRACTICE_QUESTION_CATALOGS.includes(old)||base.LISTENING_COLLECTION_QUESTIONS.length!==200||
    base.LISTENING_COLLECTION_STATS.questions!==200||!base.LISTENING_COLLECTION_STATS.ready200)fail('base-catalog');
  if(!admitted||!Array.isArray(admitted.questions)||admitted.questions.length!==12||
    admitted.combined325CanonicalSha256!==pins.combined325CanonicalSha256||typeof admitted.getAudio!=='function')fail('admission');
  // Snapshot first: a caller cannot alter later audio resolutions or question
  // objects after they have passed the independent compiled identity checks.
  const extra=JSON.parse(canonicalJson(admitted.questions)) as Question[];
  const known=new Set(old.map(q=>q.id)),ids=new Set<string>();
  for(const q of extra){
    if(!q||typeof q.id!=='string'||!q.id||known.has(q.id)||ids.has(q.id)||q.part!==1||q.groupId!==undefined)fail('question-identity');
    ids.add(q.id);
  }
  const audioRows:([string,ReviewedListeningAudio])[]=[];
  for(const q of extra){
    const audio=admitted.getAudio(q.id);
    if(!audio?.body||audio.question!==undefined||audio.body.naturalOnly!==true)fail('audio-missing');
    audioRows.push([q.id,JSON.parse(canonicalJson(audio)) as ReviewedListeningAudio]);
  }
  if(hash(audioRows)!==pins.audioBindingsCanonicalSha256)fail('audio-digest');
  const combined=[...old,...extra],newVersion='practice-v1:'+pins.combined325CanonicalSha256;
  if(hash(combined)!==pins.combined325CanonicalSha256)fail('combined-digest');
  sealPracticeCatalog(combined,newVersion);
  freezeJson(audioRows);
  const audioById=new Map(audioRows);
  const getReviewedPart1Audio=(qid:string)=>audioById.get(qid)??null;
  return Object.freeze({...base,QUESTIONS:combined,
    QUESTION_CATALOG_STATS:Object.freeze({...base.QUESTION_CATALOG_STATS,
      availableQuestions:base.QUESTION_CATALOG_STATS.availableQuestions+12,
      availableUnits:base.QUESTION_CATALOG_STATS.availableUnits+12,newPart1Questions:12}),
    QUESTION_CATALOG_VERSIONS:Object.freeze({...base.QUESTION_CATALOG_VERSIONS,part1Extra325:newVersion}),
    PRACTICE_QUESTION_CATALOGS:Object.freeze([...base.PRACTICE_QUESTION_CATALOGS,combined]),
    getQuestionAudioSelection:(qid:string)=>getReviewedPart1Audio(qid)?.body??base.getQuestionAudioSelection(qid),
    getReviewedPart1Audio});
}
