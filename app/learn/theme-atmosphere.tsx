'use client';
import {useEffect,useRef,useState} from 'react';
import {Wind} from 'lucide-react';
import {isNativeForeground,subscribeNativeState} from '@/lib/native-host';

// Appearance is device-local; changing it never creates a learning event.
const preferenceKey='lantern-scene-motion-v1';
export default function ThemeAtmosphere({kind,paused}:{kind:string;paused:boolean}){
 const host=useRef<HTMLDivElement>(null);
 const [enabled,setEnabled]=useState(false);
 const [visible,setVisible]=useState(true);
 const [background,setBackground]=useState(false);
 const [reduced,setReduced]=useState(true);
 useEffect(()=>{
  try{setEnabled(localStorage.getItem(preferenceKey)==='on');}catch{/* Session-only preference is sufficient. */}
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion=()=>setReduced(media.matches);
  const visibility=()=>setBackground(document.hidden||!isNativeForeground());
  motion();visibility();media.addEventListener('change',motion);document.addEventListener('visibilitychange',visibility);
  const unsubscribe=subscribeNativeState(visibility);
  const scene=host.current?.closest('.region-map');
  // Layout/scroll changes can batch several transitions for this one scene.
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>setVisible(entries.at(-1)?.isIntersecting??false));
  if(scene)observer?.observe(scene);
  return()=>{media.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);unsubscribe();observer?.disconnect();};
 },[]);
 const active=enabled&&!paused&&!background&&!reduced&&visible;
 function toggle(){const next=!enabled;setEnabled(next);try{localStorage.setItem(preferenceKey,next?'on':'off');}catch{/* Keep the current session usable. */}}
 return <><div ref={host} className="theme-atmosphere" data-kind={kind} data-active={active} aria-hidden="true">
  {Array.from({length:9},(_,i)=><span className="ambient-particle" key={i} style={{'--particle-x':`${8+i*10}%`,'--particle-y':`${15+(i*19)%65}%`,'--particle-duration':`${8+i%4*2}s`,'--particle-delay':`${-i*1.7}s`} as React.CSSProperties}/>)}
  <span className="ambient-water"/>
 </div><button className="scene-motion-toggle" type="button" aria-pressed={enabled} onClick={toggle} disabled={reduced} aria-label={reduced?'系统已减弱动态':enabled?'关闭轻动效':'开启轻动效'}><Wind size={14}/>{reduced?'系统已减弱动态':enabled?'轻动效已开启':'开启轻动效'}</button></>;
}
