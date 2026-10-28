'use client';
import {createContext,useContext} from 'react';
import type {AccountAccess} from './session-proof';
export const LearningAccessContext=createContext<AccountAccess|null>(null);
const deny=()=>false;
/** Missing or mismatched providers never authorize account storage operations. */
export function useLearningAccess(owner?:string|null,renderOnly=false){const access=useContext(LearningAccessContext);return access&&(owner===undefined||access.owner===owner)?renderOnly?access.canAccess:access.assertAccess:deny;}
