import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkVersionConsistency} from '../scripts/check-version-consistency.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lantern-version-check-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const write = async (file, value) => {
    await mkdir(path.dirname(path.join(root, file)), {recursive:true});
    await writeFile(path.join(root, file), JSON.stringify(value));
  };
  const version='0.4.8', lock={version,packages:{'':{version}}};
  await write('harmony/AppScope/app.json5',{app:{versionName:version,versionCode:20079}});
  for (const file of ['release-manifest.json','package.json','mobile/package.json','harmony/package.json']) await write(file,{version});
  for (const file of ['package-lock.json','mobile/package-lock.json']) await write(file,lock);
  return {root,write};
}

test('source configuration agrees without pretending inherited identity is a frozen build',async t=>{
  const {root,write}=await fixture(t);
  await write('public/build-identity.json',{versionName:'0.4.7',versionCode:20076});
  assert.deepEqual(await checkVersionConsistency(root),{versionName:'0.4.8',versionCode:20079});
});
test('every candidate version and both lockfile root values are checked',async t=>{
  for (const file of ['release-manifest.json','package.json','mobile/package.json','harmony/package.json','package-lock.json','mobile/package-lock.json']) {
    await t.test(file,async sub=>{
      const {root,write}=await fixture(sub);
      await write(file,file.includes('lock')?{version:'0.4.6',packages:{'':{version:'0.4.8'}}}:{version:'0.4.6'});
      await assert.rejects(checkVersionConsistency(root),/Version mismatch/);
      if(file.includes('lock')){
        await write(file,{version:'0.4.8',packages:{'':{version:'0.4.6'}}});
        await assert.rejects(checkVersionConsistency(root),/Version mismatch/);
      }
    });
  }
});
test('invalid build codes fail closed',async t=>{
  const {root,write}=await fixture(t);
  for (const code of [0,-1,1.5,'20079',null]) {
    await write('harmony/AppScope/app.json5',{app:{versionName:'0.4.8',versionCode:code}});
    await assert.rejects(checkVersionConsistency(root),/Invalid AppScope/);
  }
});
