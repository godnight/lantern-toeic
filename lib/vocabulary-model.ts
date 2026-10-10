import {createId} from './study-model';
export {createId as vocabularyId} from './study-model';
export type Word = {id:string;word:string;pos:string;meaning:string;category:string;example:string;translation:string;collocation:string};
export const CATEGORIES:Record<string,string>={office:'办公事务',people:'招聘与人事',meetings:'会议与培训',finance:'财务与账单',sales:'销售与客户',logistics:'采购与物流',travel:'出差与交通',hospitality:'酒店与餐饮',technology:'技术与通信',facilities:'场地与维护',health:'健康与福利',services:'社区与生活服务',questions:'题内词汇'};
export type VocabularyEvent = {id:string;wordId:string;createdAt:string} & ({type:'mark';starred:boolean;revision:number}|{type:'review';grade:'again'|'remembered'});
export type VocabularyBackup={kind:'lantern-vocabulary';schemaVersion:1;events:VocabularyEvent[]};
export const searchText=(value:string)=>value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
export function searchWords(words:Word[],query:string,category='all') {
 const terms=searchText(query).split(' ').filter(Boolean);
 return words.filter(w=>(category==='all'||w.category===category)&&terms.every(term=>searchText([w.word,w.meaning,w.collocation,w.example,w.translation].join(' ')).includes(term)));
}
const ID=/^[a-zA-Z0-9-]{1,100}$/;
export function validVocabularyEvent(value:unknown):value is VocabularyEvent {
 if(!value||typeof value!=='object')return false;
 const e=value as VocabularyEvent;
 return typeof e.id==='string'&&ID.test(e.id)&&typeof e.wordId==='string'&&ID.test(e.wordId)&&typeof e.createdAt==='string'&&/^\d{4}-\d\d-\d\dT/.test(e.createdAt)&&Number.isFinite(Date.parse(e.createdAt))&&Date.parse(e.createdAt)<=Date.now()+300000&&
 (e.type==='mark'?typeof e.starred==='boolean'&&Number.isSafeInteger(e.revision)&&e.revision>=1:e.type==='review'&&(e.grade==='again'||e.grade==='remembered'));
}
export function parseVocabularyBackup(input:unknown):VocabularyBackup {
 const b=input as VocabularyBackup;
 if(!b||b.kind!=='lantern-vocabulary'||b.schemaVersion!==1||!Array.isArray(b.events)||b.events.length>100000||!b.events.every(validVocabularyEvent))throw Error('词库备份格式或版本不支持，原记录未改动。');
 const events=mergeVocabularyEvents([],b.events.map(e=>e.type==='mark'?{id:e.id,wordId:e.wordId,createdAt:e.createdAt,type:e.type,starred:e.starred,revision:e.revision}:{id:e.id,wordId:e.wordId,createdAt:e.createdAt,type:e.type,grade:e.grade}));
 return {kind:'lantern-vocabulary',schemaVersion:1,events};
}
export function mergeVocabularyEvents(a:VocabularyEvent[],b:VocabularyEvent[]) {
 const map=new Map<string,VocabularyEvent>();
 for(const raw of [...a,...b]){const e=raw.type==='mark'?{id:raw.id,wordId:raw.wordId,createdAt:new Date(raw.createdAt).toISOString(),type:raw.type,starred:raw.starred,revision:raw.revision}:{id:raw.id,wordId:raw.wordId,createdAt:new Date(raw.createdAt).toISOString(),type:raw.type,grade:raw.grade};const old=map.get(e.id);if(old&&JSON.stringify(old)!==JSON.stringify(e))throw Error('词库记录标识冲突，请保留原备份。');map.set(e.id,e);}
 return [...map.values()].sort((x,y)=>Date.parse(x.createdAt)-Date.parse(y.createdAt)||(x.id<y.id?-1:x.id>y.id?1:0));
}
export function vocabularyState(events:VocabularyEvent[],wordId:string) {
 const rows=events.filter(e=>e.wordId===wordId).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0));
 const marks=rows.filter((e):e is VocabularyEvent & {type:'mark'}=>e.type==='mark').sort((a,b)=>b.revision-a.revision||Number(a.starred)-Number(b.starred)||(a.id<b.id?1:a.id>b.id?-1:0));
 let level=0,due=0,reviews=0;
 for(const e of rows){if(e.type!=='review')continue;reviews++;const time=Date.parse(e.createdAt);if(e.grade==='again'){level=0;due=time+600000;}else if(!due||time>=due){level=Math.min(5,level+1);due=time+[1,3,7,14,30][level-1]*86400000;}}
 return {starred:marks[0]?.starred??false,revision:marks[0]?.revision??0,level,due,reviews};
}
export function vocabularyKey(owner:string|null){return owner===null?'lantern-vocab-v1:device:':'lantern-vocab-v1:owner:'+encodeURIComponent(owner)+':';}
type StorageLike=Pick<Storage,'length'|'key'|'getItem'|'setItem'>;
export function readVocabulary(storage:StorageLike,key:string):VocabularyEvent[]{
 let events:VocabularyEvent[]=[];
 for(let i=0;i<storage.length;i++){const name=storage.key(i);if(name?.startsWith(key)){const raw=storage.getItem(name);if(raw!==null)events=mergeVocabularyEvents(events,parseVocabularyBackup(JSON.parse(raw)).events);}}
 return events;
}
export function writeVocabulary(storage:StorageLike,key:string,incoming:VocabularyEvent[]) {
 const old=readVocabulary(storage,key);const merged=mergeVocabularyEvents(old,parseVocabularyBackup({kind:'lantern-vocabulary',schemaVersion:1,events:incoming}).events);
 const known=new Set(old.map(e=>e.id));const added=merged.filter(e=>!known.has(e.id));
 if(added.length)storage.setItem(key+createId(),JSON.stringify({kind:'lantern-vocabulary',schemaVersion:1,events:added}));
 return merged;
}
