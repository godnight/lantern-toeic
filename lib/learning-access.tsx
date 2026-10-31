'use client';
import {createContext,useContext} from 'react';
import type {AccountAccess} from './session-proof';
export const LearningAccessContext=createContext<AccountAccess|null>(null);
const deny=()=>false;
/** Missing or mismatched providers never authorize account storage operations. */
export function useLearningAccess(owner?:string|null,renderOnly=false){const access=useContext(LearningAccessContext);return access&&(owner===undefined||access.owner===owner)?renderOnly?access.canAccess:access.assertAccess:deny;}

/** Presentation comes only from this proof's matching in-memory identity. */
export function useVerifiedLearningAccount(owner:string|null){const access=useContext(LearningAccessContext);return access?.owner===owner&&access.user?.id===owner&&access.canAccess()?{user:access.user,epoch:access.epoch}:null;}
