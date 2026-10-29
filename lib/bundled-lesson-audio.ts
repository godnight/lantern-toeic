type Clip={text:string;file:string;sha256?:string};
let sources=new Map<string,string>(),clips=new Map<string,string>();
/** The native shell can register packaged clips without importing natural
 * audio admission, its locator or any learning content. */
export function installBundledLessonAudio(input:Clip[]){
 const next=new Map<string,string>(),identities=new Map<string,string>();
 for(const clip of input){
  if(!/^[a-f0-9]{20}\.mp3$/.test(clip.file))throw Error('Invalid bundled audio filename');
  if(next.has(clip.text))throw Error('Duplicate bundled audio text');
  next.set(clip.text,'/audio/offline/'+clip.file);
  identities.set(clip.text,'bundled:'+clip.file+':'+(clip.sha256??clip.file));
 }
 clips=next;sources=identities;
}
export const registeredBundledClip=(text:string)=>clips.get(text)??null;
export const registeredBundledSource=(text:string)=>sources.get(text)??null;
