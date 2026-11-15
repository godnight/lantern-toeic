// Fixed repository inputs; neither requests nor runtime settings select code.
// Builds return in-memory artifacts only; they do not start or publish services.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifact = result => {
  const bytes = Buffer.from(result.outputFiles[0].contents);
  return Object.freeze({ bytes, sha: createHash('sha256').update(bytes).digest('hex') });
};

export async function buildAccountWorker() {
  const result = await build({ absWorkingDir: root, entryPoints: ['server/cloud-candidate/auth-worker.ts'], bundle: true, write: false,
    format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:workers'], legalComments: 'none' });
  return artifact(result);
}

export async function buildSyncModel() {
  const source = `export {validVocabularyEvent,mergeVocabularyEvents} from './lib/vocabulary-model.ts';
export {readNativeStudyPage} from './worker/native-study-page.ts';
export {QUESTIONS} from './lib/question-catalog.ts';`;
  const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, write: false,
    minify: true, legalComments: 'none', format: 'esm', platform: 'node', target: 'node22' });
  const resultArtifact = artifact(result);
  return Object.freeze({ sha: resultArtifact.sha, importModel: () => import('data:text/javascript;base64,' + resultArtifact.bytes.toString('base64')) });
}
