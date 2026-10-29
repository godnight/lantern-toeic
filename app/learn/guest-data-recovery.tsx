'use client';
import {PreparedStudyContent} from './prepared-study-content';
const loadRecovery=()=>import('./guest-data-recovery-content').then(module=>module.GuestDataRecovery);
const current=()=>true;
export function GuestDataRecovery(props:{nativeMode:boolean;onBack:()=>void}){
 return <PreparedStudyContent loader={loadRecovery} componentProps={props} current={current} onBack={props.onBack}/>;
}
