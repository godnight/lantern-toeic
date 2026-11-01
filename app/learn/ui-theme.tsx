'use client';

import {useEffect,useState} from 'react';
import type {CSSProperties} from 'react';
import {Check} from 'lucide-react';
import type {Theme} from '@/lib/study-model';
import {UI_THEME_ORDER} from '@/lib/ui-theme';

export type ThemeMotifProps = {theme:Theme};
export type ThemeBrandMarkProps = {size?:number;className?:string};

/** Keep the existing approved brand asset; scene art is a separate component. */
export function ThemeBrandMark({size=40,className=''}:ThemeBrandMarkProps){
  return <img className={`phase2-brand-mark ${className}`.trim()}
    src="/phase2-theme/knight-icon-96.png"
    srcSet="/phase2-theme/knight-icon-48.png 48w, /phase2-theme/knight-icon-64.png 64w, /phase2-theme/knight-icon-96.png 96w, /phase2-theme/knight-icon-256.png 256w"
    sizes={`${size}px`} width={size} height={size} alt="" aria-hidden="true" decoding="async"/>;
}

export type ThemeSceneKind='blue-lake'|'dirtmouth'|'home'|'ambient'|'resources'|'calm';
export type ThemeSceneProps={theme:Theme;scene?:ThemeSceneKind;caption?:string;className?:string;loading?:'eager'|'lazy'};
type SceneAsset={id:string;position:string;complete?:boolean};
const ASSETS:Record<string,SceneAsset>={
  'hollow-home':{id:'hollow-home',position:'70% 52%'},
  'hollow-rain':{id:'hollow-rain',position:'56% 48%'},
  'hollow-lake':{id:'hollow-lake',position:'50% 50%',complete:true},
  'hollow-station':{id:'hollow-station',position:'60% 54%',complete:true},
  'silk-home':{id:'silk-home',position:'30% 52%'},
  'silk-forest':{id:'silk-forest',position:'55% 47%'},
  'silk-library':{id:'silk-library',position:'60% 48%'},
  'silk-calm':{id:'silk-calm',position:'44% 48%',complete:true}
};

function sceneAsset(theme:Theme,scene:ThemeSceneKind):SceneAsset|null{
  if(theme==='hollow')return ASSETS[scene==='home'||scene==='dirtmouth'?'hollow-home':scene==='ambient'?'hollow-rain':scene==='resources'?'hollow-station':'hollow-lake'];
  if(theme==='silk'&&scene!=='blue-lake')return ASSETS[scene==='home'?'silk-home':scene==='ambient'?'silk-forest':scene==='resources'?'silk-library':'silk-calm'];
  return null;
}

/** Independent decorative image window; it never owns navigation or learning state. */
export function ThemeScene({theme,scene='blue-lake',caption,className='',loading}:ThemeSceneProps){
  const asset=sceneAsset(theme,scene);
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[asset?.id]);
  if(!asset){
    if(scene!=='home'||theme==='hollow'||theme==='silk')return null;
    return <div className={`v041-theme-scene v041-theme-scene--home v041-theme-neutral v041-theme-neutral--${theme} ${className}`.trim()} data-scene={scene} aria-hidden="true">
      <span className="v041-neutral-page"/><span className="v041-neutral-light"/>
    </div>;
  }
  const complete=asset.complete===true;
  return <figure className={`phase2-scene-window v041-theme-scene v041-theme-scene--${scene}${complete?' v041-theme-scene--complete':''} ${className}`.trim()}
    data-scene={scene} data-scene-source={asset.id} data-scene-status={failed?'unavailable':'available'} aria-hidden={caption?undefined:true}
    style={{'--scene-position':asset.position} as CSSProperties}>
    {failed?<div className="v041-scene-placeholder" aria-hidden="true"><span/></div>:<img
      src={`/design-r1/${asset.id}.webp`} width={1672} height={941} alt=""
      loading={loading??(scene==='home'?'eager':'lazy')} fetchPriority={scene==='home'?'high':'auto'} decoding="async"
      onError={()=>setFailed(true)}/>}
    {caption&&scene!=='blue-lake'&&<figcaption>{caption}</figcaption>}
  </figure>;
}

/** The page scene replaces repeated logo ornaments in ordinary headings. */
export function ThemeMotif(_props:ThemeMotifProps){return null;}

export type ThemeChooserProps={theme:Theme;onChange:(theme:Theme)=>void;disabled?:boolean};
const NAMES:Record<Theme,string>={paper:'日间',crystal:'夜间',hollow:'空洞骑士',silk:'丝之歌'};

/** One real theme change action; the parent remains the only persisted-state writer. */
export function ThemeChooser({theme,onChange,disabled=false}:ThemeChooserProps){
  return <div className="ui-theme-chooser v041-theme-chooser" role="group" aria-label="界面主题">
    {UI_THEME_ORDER.map(candidate=>{
      const selected=theme===candidate;
      const art=candidate==='hollow'?ASSETS['hollow-home']:candidate==='silk'?ASSETS['silk-home']:null;
      return <button key={candidate} type="button" className="ui-theme-card v041-theme-option"
        data-theme-choice={candidate} aria-pressed={selected} disabled={disabled}
        aria-label={`${NAMES[candidate]}${selected?'，正在使用':''}`}
        onClick={()=>{if(!selected)onChange(candidate);}}>
        <span className={`v041-theme-thumb v041-theme-thumb--${candidate}`} aria-hidden="true">
          {art&&<img src={`/design-r1/${art.id}.webp`} style={{objectPosition:art.position}} width={1672} height={941} alt="" loading="lazy" decoding="async" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>}
        </span>
        <span className="v041-theme-option-name"><strong>{NAMES[candidate]}</strong><span className="v041-theme-check" aria-hidden="true">{selected&&<Check size={18}/>}</span></span>
      </button>;
    })}
  </div>;
}
