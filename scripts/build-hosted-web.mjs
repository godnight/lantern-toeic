import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [script, ...args] of [
  ['scripts/build-verified.mjs'],
  ['scripts/prune-web-natural-media.mjs', '--apply'],
]) {
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], {cwd: root, stdio: 'inherit', windowsHide: true});
    child.once('error', error => { console.error(error.message); resolve(1); });
    child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (code !== 0) { process.exitCode = code; break; }
}
