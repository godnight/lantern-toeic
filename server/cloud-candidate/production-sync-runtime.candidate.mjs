// Shared production gating; receives only trusted local objects from launcher.
// Does not read configuration or open a public socket.
import {parseProductionSyncSettings,validateSyncDatabase,importPinnedSyncModel,requireIndependentSyncKey} from './production-sync-preflight.candidate.mjs';
import {createUnifiedD1Sync} from './unified-d1-sync.candidate.mjs';
export async function prepareProductionSyncRuntime({settings,mf,origin,privateRoot,key,proxy,phoneKey,modelInfo}={}){
 const config=parseProductionSyncSettings(settings,origin,privateRoot);if(!config.enabled)throw Error('sync disabled');
 if(!mf||typeof mf.getD1Database!=='function'||typeof mf.dispatchFetch!=='function')throw Error('account runtime unavailable');
 await validateSyncDatabase(await mf.getD1Database('DB'));
 if(!Buffer.isBuffer(phoneKey)||phoneKey.length!==32)throw Error('phone reference key unavailable');
 requireIndependentSyncKey(key,proxy,phoneKey);
 const model=await importPinnedSyncModel(modelInfo,config.modelSha256);
 return createUnifiedD1Sync({enabled:true,mf,origin,cursorKey:key,model});
}
