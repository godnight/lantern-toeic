'use client';

import {useState} from 'react';
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

export type ThemeSceneKind='todayHero'|'todayRest'|'vocabularyOverview'|'reviewOverview'|'progressOverview'|'practiceOverview'|'resourceLibrary'|'wordComplete';
type LegacySceneKind='blue-lake'|'dirtmouth'|'home'|'ambient'|'resources'|'calm';
export type ThemeSceneProps={theme:Theme;scene?:ThemeSceneKind|LegacySceneKind;caption?:string;className?:string;loading?:'eager'|'lazy'};
type SceneAsset={id:string;position:string;contain?:boolean;path?:string;background?:string;mobilePath?:string};
const ASSETS:Record<string,SceneAsset>={
  'hollow-home':{id:'hollow-home',position:'70% 52%',background:"image-set(url('/phase2-theme/dirtmouth-hd-1x.webp') 1x,url('/phase2-theme/dirtmouth-hd-2x.webp') 2x,url('/phase2-theme/dirtmouth-hd-3x.webp') 3x)"},
  'hollow-rain':{id:'hollow-rain',position:'56% 48%'},
  'hollow-lake':{id:'hollow-lake',position:'50% 50%',contain:true},
  'hollow-station':{id:'hollow-station',position:'60% 54%'},
  'greenpath':{id:'greenpath',position:'50% 50%',path:'/images/maps/greenpath.webp',mobilePath:'/images/maps/greenpath-mobile.webp'},
  'white-palace':{id:'white-palace',position:'50% 50%',path:'/images/maps/white-palace.webp'},
  'crystal-peak':{id:'crystal-peak',position:'50% 50%',path:'/images/maps/crystal-peak.webp'},
  'silk-home':{id:'silk-home',position:'30% 52%'},
  'silk-forest':{id:'silk-forest',position:'55% 47%'},
  'silk-library':{id:'silk-library',position:'60% 48%'},
  'silk-calm':{id:'silk-calm',position:'44% 48%',contain:true},
  'crimson-bell-tower':{id:'crimson-bell-tower',position:'50% 50%',path:'/images/lantern-crimson-bell-tower.webp'},
  'greymoor':{id:'greymoor',position:'50% 50%',path:'/images/maps/greymoor.webp',mobilePath:'/images/maps/greymoor-mobile.webp'},
  'snowy-ridge':{id:'snowy-ridge',position:'50% 50%',path:'/images/themes-v3/snowy-ridge-wide.webp'},
  'whale-bay-home':{id:'whale-bay-home',position:'72% 48%',contain:true,path:'/images/whale-themes/whale-bay-home.webp'},
  'whale-moon-home':{id:'whale-moon-home',position:'72% 48%',contain:true,path:'/images/whale-themes/whale-moon-home.webp'},
  'whale-bay-study':{id:'whale-bay-study',position:'50% 50%',path:'/images/whale-themes/whale-bay-study.webp'},
  'whale-moon-study':{id:'whale-moon-study',position:'50% 50%',path:'/images/whale-themes/whale-moon-study.webp'},
  'bay-word-lighthouse':{id:'bay-word-lighthouse',position:'50% 12%',path:'/images/whale-scenes-20261115/bay-word-lighthouse.webp'},
  'bay-progress-cliff':{id:'bay-progress-cliff',position:'50% 32%',path:'/images/whale-scenes-20261115/bay-progress-cliff.webp'},
  'bay-resource-bookshop':{id:'bay-resource-bookshop',position:'50% 36%',path:'/images/whale-scenes-20261115/bay-resource-bookshop.webp'},
  'bay-practice-dawn-pier':{id:'bay-practice-dawn-pier',position:'50% 50%',path:'/images/whale-scenes-20261115/bay-practice-dawn-pier.webp'},
  'bay-review-tide-garden':{id:'bay-review-tide-garden',position:'50% 50%',path:'/images/whale-scenes-20261115/bay-review-tide-garden.webp'},
  'moon-review-moonlit-cove':{id:'moon-review-moonlit-cove',position:'50% 50%',path:'/images/whale-scenes-20261115/moon-review-moonlit-cove.webp'},
  'moon-progress-star-observatory':{id:'moon-progress-star-observatory',position:'50% 50%',path:'/images/whale-scenes-20261115/moon-progress-star-observatory.webp'},
  'moon-word-gallery':{id:'moon-word-gallery',position:'50% 45%',path:'/images/whale-scenes-20261115/moon-word-gallery.webp'},
  'moon-practice-reef':{id:'moon-practice-reef',position:'50% 12%',path:'/images/whale-scenes-20261115/moon-practice-reef.webp'},
  'moon-resource-bookshop':{id:'moon-resource-bookshop',position:'50% 21%',path:'/images/whale-scenes-20261115/moon-resource-bookshop.webp'}
};
const LEGACY_SCENE:Record<LegacySceneKind,ThemeSceneKind>={home:'todayHero','blue-lake':'todayRest',dirtmouth:'wordComplete',ambient:'practiceOverview',resources:'resourceLibrary',calm:'reviewOverview'};
const hollowSlots:Record<ThemeSceneKind,string>={todayHero:'hollow-home',todayRest:'hollow-lake',vocabularyOverview:'greenpath',reviewOverview:'white-palace',progressOverview:'crystal-peak',practiceOverview:'hollow-rain',resourceLibrary:'hollow-station',wordComplete:'hollow-home'};
const silkSlots:Record<ThemeSceneKind,string>={todayHero:'silk-home',todayRest:'silk-calm',vocabularyOverview:'silk-forest',reviewOverview:'greymoor',progressOverview:'snowy-ridge',practiceOverview:'crimson-bell-tower',resourceLibrary:'silk-library',wordComplete:'silk-home'};
const baySlots:Record<ThemeSceneKind,string>={todayHero:'whale-bay-study',todayRest:'whale-bay-home',vocabularyOverview:'bay-word-lighthouse',reviewOverview:'bay-review-tide-garden',progressOverview:'bay-progress-cliff',practiceOverview:'bay-practice-dawn-pier',resourceLibrary:'bay-resource-bookshop',wordComplete:'whale-bay-home'};
const moonSlots:Record<ThemeSceneKind,string>={todayHero:'whale-moon-study',todayRest:'whale-moon-home',vocabularyOverview:'moon-word-gallery',reviewOverview:'moon-review-moonlit-cove',progressOverview:'moon-progress-star-observatory',practiceOverview:'moon-practice-reef',resourceLibrary:'moon-resource-bookshop',wordComplete:'whale-moon-home'};
function sceneAsset(theme:Theme,slot:ThemeSceneKind):SceneAsset|null{
  if(theme==='hollow')return ASSETS[hollowSlots[slot]];
  if(theme==='silk')return ASSETS[silkSlots[slot]];
  if(theme==='whale-bay')return ASSETS[baySlots[slot]];
  if(theme==='whale-moon')return ASSETS[moonSlots[slot]];
  return null;
}
const PAGE_SCENE:Readonly<Record<string,ThemeSceneKind>>={today:'todayHero',vocabulary:'vocabularyOverview',review:'reviewOverview',progress:'progressOverview',train:'practiceOverview',resources:'resourceLibrary',profile:'resourceLibrary',themes:'resourceLibrary',about:'resourceLibrary',settings:'resourceLibrary'};
/** Backgrounds and image frames resolve through the same page-purpose map. */
export function workspaceSceneBackdrop(theme:Theme,nav:string,discoveryFeedActive=false):{id:string;background:string;mobileBackground:string}|null{
  if(nav==='resources'&&discoveryFeedActive)return null;
  const slot=PAGE_SCENE[nav]??(theme==='whale-bay'||theme==='whale-moon'?'resourceLibrary':null);
  if(!slot)return null;
  const asset=sceneAsset(theme,slot);if(!asset)return null;
  const path=asset.path??`/design-r1/${asset.id}.webp`;
  const background=asset.background??`url('${path}')`;
  return {id:asset.id,background,mobileBackground:asset.mobilePath?`url('${asset.mobilePath}')`:background};
}

/** The page decides which slot exists; every theme keeps the same image frame. */
export function ThemeScene({theme,scene='todayHero',caption,className='',loading}:ThemeSceneProps){
  const slot=scene in LEGACY_SCENE?LEGACY_SCENE[scene as LegacySceneKind]:scene as ThemeSceneKind;
  const asset=sceneAsset(theme,slot);
  // A new asset selection starts a fresh load, even when returning to a prior
  // asset. The generation also rejects errors from an earlier, detached image.
  const selectedId=asset?.id??`neutral-${theme}`;
  const [imageState,setImageState]=useState(()=>({id:selectedId,generation:0,failed:false}));
  let current=imageState;
  if(imageState.id!==selectedId){current={id:selectedId,generation:imageState.generation+1,failed:false};setImageState(current);}
  const generation=current.generation,failed=!!asset&&current.failed;
  const neutral=asset===null;
  return <figure className={`phase2-scene-window v041-theme-scene v041-theme-scene--${slot}${asset?.contain?' v041-theme-scene--contain':''}${neutral?` v041-theme-neutral v041-theme-neutral--${theme}`:''} ${className}`.trim()}
    data-scene={slot} data-scene-source={asset?.id??`neutral-${theme}`} data-scene-status={failed?'unavailable':'available'} aria-hidden={caption?undefined:true}
    style={{'--scene-position':asset?.position??'50% 50%'} as CSSProperties}>
    {neutral?<><span className="v041-neutral-page"/><span className="v041-neutral-light"/></>:failed?<div className="v041-scene-placeholder" aria-hidden="true"><span/></div>:<img
      src={asset.path??`/design-r1/${asset.id}.webp`} width={1672} height={941} alt=""
      loading={loading??(slot==='todayHero'?'eager':'lazy')} fetchPriority={slot==='todayHero'?'high':'auto'} decoding="async"
      onError={()=>setImageState(previous=>previous.id===asset.id&&previous.generation===generation?{...previous,failed:true}:previous)}/>}
    {caption&&<figcaption>{caption}</figcaption>}
  </figure>;
}

/** The page scene replaces repeated logo ornaments in ordinary headings. */
export function ThemeMotif(_props:ThemeMotifProps){return null;}

export type ThemeChooserProps={theme:Theme;onChange:(theme:Theme)=>void;disabled?:boolean};
const NAMES:Record<Theme,string>={paper:'日间',crystal:'夜间',hollow:'空洞骑士',silk:'丝之歌','whale-bay':'咕噜海湾','whale-moon':'澜音星海'};

/** One real theme change action; the parent remains the only persisted-state writer. */
export function ThemeChooser({theme,onChange,disabled=false}:ThemeChooserProps){
  return <div className="ui-theme-chooser v041-theme-chooser" role="group" aria-label="界面主题">
    {UI_THEME_ORDER.map(candidate=>{
      const selected=theme===candidate;
      const art=candidate==='hollow'?ASSETS['hollow-home']:candidate==='silk'?ASSETS['silk-home']:candidate==='whale-bay'||candidate==='whale-moon'?ASSETS[candidate+'-home']:null;
      return <button key={candidate} type="button" className="ui-theme-card v041-theme-option"
        data-theme-choice={candidate} aria-pressed={selected} disabled={disabled}
        aria-label={`${NAMES[candidate]}${selected?'，正在使用':''}`}
        onClick={()=>{if(!selected)onChange(candidate);}}>
        <span className={`v041-theme-thumb v041-theme-thumb--${candidate}`} aria-hidden="true">
          {art&&<img src={art.path??`/design-r1/${art.id}.webp`} style={{objectPosition:art.position}} width={1672} height={941} alt="" loading="lazy" decoding="async" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>}
        </span>
        <span className="v041-theme-option-name"><strong>{NAMES[candidate]}</strong><span className="v041-theme-check" aria-hidden="true">{selected&&<Check size={18}/>}</span></span>
      </button>;
    })}
  </div>;
}
