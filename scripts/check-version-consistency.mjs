// Source configuration only. Frozen build identities are generated and checked
// separately by freeze-workflow-build.py; an inherited identity is not a build.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkVersionConsistency(directory = root) {
  const read = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  const app = (await read('harmony/AppScope/app.json5')).app;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(app?.versionName || '') ||
      !Number.isSafeInteger(app?.versionCode) || app.versionCode < 1) {
    throw new Error('Invalid AppScope versionName or versionCode');
  }
  const expected = app.versionName;
  for (const file of ['release-manifest.json', 'package.json', 'mobile/package.json', 'harmony/package.json']) {
    if ((await read(file)).version !== expected) throw new Error(`Version mismatch: ${file} must match AppScope ${expected}`);
  }
  for (const file of ['package-lock.json', 'mobile/package-lock.json']) {
    const lock = await read(file);
    if (lock.version !== expected || lock.packages?.['']?.version !== expected)
      throw new Error(`Version mismatch: ${file} root and package versions must match AppScope ${expected}`);
  }
  return {versionName: expected, versionCode: app.versionCode};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = await checkVersionConsistency();
    console.log(`Source version consistent: ${version.versionName} / ${version.versionCode} (not a build or deployment check)`);
  } catch (error) {
    console.error(`Source version check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
