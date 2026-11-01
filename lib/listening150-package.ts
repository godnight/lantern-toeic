import {captureCompiledListening150Package} from './listening150-package-admission';
import {admitListening150Package} from './listening150-catalog';
const completeListening150PackageSynchronously=()=>{const value=captureCompiledListening150Package();return admitListening150Package(value.input,value.pins);};
import {installServerListening150Package,readPreparedListening150Package} from './prepare-listening150-package';
// Missing browser preparation cannot masquerade as the old 163 catalogue.
export const LISTENING150_ADMISSION=typeof window==='undefined'?installServerListening150Package(completeListening150PackageSynchronously):readPreparedListening150Package();
export const LISTENING150_STATUS=LISTENING150_ADMISSION?'READY_PRIVATE_EXACT_MEDIA':'PENDING_EXACT_MEDIA_AND_IMAGES';
