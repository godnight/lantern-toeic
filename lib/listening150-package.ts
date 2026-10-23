import {admitListening150Package,type Listening150Input,type Listening150Pins} from './listening150-catalog';

/** Root replaces only this module after exact images/media/compiled routes seal.
 * No incomplete package, placeholder SHA or caller activation can admit a row.
 */
const sealed=null as Readonly<{input:Listening150Input;pins:Listening150Pins}>|null;
export const LISTENING150_ADMISSION=sealed?admitListening150Package(sealed.input,sealed.pins):null;
export const LISTENING150_STATUS=LISTENING150_ADMISSION?'READY_PRIVATE_EXACT_MEDIA':'PENDING_EXACT_MEDIA_AND_IMAGES';
