import membershipsData from '../content/wordlists/merged-memberships.json';
import wordbooksData from '../content/wordlists/wordbooks.json';
import sourceMetadata from '../content/wordlists/source-metadata.json';

export type MembershipListId = 'ngsl-1.2' | 'tsl-1.2' | 'ngsl-supplement';
export type MemberWordbookId = 'general-base-1.2' | 'toeic-supplement-1.2' | 'ngsl-unranked-supplement' | 'combined-core-1.2' | 'combined-with-supplement-1.2';
export type WordMembership = {listId:MembershipListId;sourceRow:number;sourceLemma:string;rankWithinList?:number};
export type MemberWordbook = {id:MemberWordbookId;title:string;lemmas:readonly string[];count:number};
// Exact headwords only. Keep accents, hyphens, phrases and source spellings.
export const membershipKey=(word:string)=>word.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
export const MEMBERSHIP_LABELS:Record<MembershipListId,string>={'ngsl-1.2':'NGSL基础 1.2','tsl-1.2':'TSL托业补充 1.2','ngsl-supplement':'日期与数字补充'};
export const WORDLIST_SOURCES=sourceMetadata;
export const MEMBER_WORDBOOKS=wordbooksData as readonly MemberWordbook[];
const byLemma=new Map<string,readonly WordMembership[]>(membershipsData.map(row=>[row.lemma,row.memberships as WordMembership[]]));
const books=new Map<string,MemberWordbook>(MEMBER_WORDBOOKS.map(book=>[book.id,book]));
const membersByBook=new Map(MEMBER_WORDBOOKS.map(book=>[book.id,new Set(book.lemmas)]));
export function isMemberWordbookId(value:unknown):value is MemberWordbookId{return typeof value==='string'&&books.has(value);}
export function getWordMemberships(word:string):readonly WordMembership[]{return byLemma.get(membershipKey(word))??[];}
export function getMemberWordbook(id:MemberWordbookId){return books.get(id)!;}
export function belongsToWordbook(word:string,id:MemberWordbookId){return membersByBook.get(id)?.has(membershipKey(word))??false;}
