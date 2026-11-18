'use strict';
// Source contract: the native runtime bridge remains off until the missing
// migration, account lifecycle and service paths receive end-to-end validation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const index=read('harmony/entry/src/main/ets/pages/Index.ets'),config=read('harmony/entry/src/main/ets/sync/SyncConfiguration.ets');
function section(begin,end){const a=index.indexOf(begin),b=index.indexOf(end,a+begin.length);assert.ok(a>=0&&b>a,begin);return index.slice(a,b);}
test('production configuration cannot register the unready sync bridge',()=>{
 assert.match(config,/export const NATIVE_CLOUD_SYNC_ENABLED:\s*boolean\s*=\s*false\s*;/);
 const attach=section('.onControllerAttached(() => {','.onPageBegin(');
 const guard=attach.indexOf('if (NATIVE_CLOUD_SYNC_ENABLED) {');
 assert.ok(guard>=0&&attach.indexOf('new NativeSyncHost',guard)>guard&&attach.indexOf('new NativeStudySyncHost',guard)>guard);
 assert.match(attach,/if \(nativeSync\.attach\(\) && nativeStudySync\.attach\(\) && nativeLifecycle\.attach\(\)\)/);
 assert.match(attach,/nativeSync\.dispose\(\);\s*nativeStudySync\.dispose\(\);\s*nativeLifecycle\.dispose\(\);/);
});
test('document, foreground and disposal paths invalidate or dispose both bridges',()=>{
 const invalidate=section('private invalidateBridge(): void {','private onForegroundChanged(): void {');
 assert.match(invalidate,/this\.syncHost\?\.invalidate\(\)/);assert.match(invalidate,/this\.studySyncHost\?\.invalidate\(\)/);
 const foreground=section('private onForegroundChanged(): void {','private startBridgeSync(): void {');assert.match(foreground,/this\.startBridgeSync\(\)/);
 const start=section('private startBridgeSync(): void {','private syncBridge(');assert.match(start,/this\.invalidateBridge\(\)/);
 const page=section('private pageBegin(','private pageEnd(');assert.match(page,/this\.invalidateBridge\(\)/);
 const dispose=section('aboutToDisappear(): void {','private context():');
 assert.ok(dispose.indexOf('this.syncHost?.dispose()')<dispose.indexOf('this.authHost?.dispose()'));
 assert.ok(dispose.indexOf('this.studySyncHost?.dispose()')<dispose.indexOf('this.authHost?.dispose()'));
 assert.ok(dispose.indexOf('this.syncLifecycleObserver?.dispose()')<dispose.indexOf('this.authHost?.dispose()'));
});
