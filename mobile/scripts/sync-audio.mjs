import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'mobile/offline-audio');
const target = path.join(root, 'mobile/dist/audio/offline');
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const questions = JSON.parse(await readFile(path.join(root, 'content/questions.json'), 'utf8'));
const speaking = JSON.parse(await readFile(path.join(root, 'content/speaking.json'), 'utf8'));
const required = new Set();
for (const question of questions) {
  if (question.part <= 4) required.add(question.audioText || question.transcript || question.prompt);
  for (const sentence of (question.transcript || question.audioText || '').split(/(?<=[.!?])\s+/).filter(Boolean)) required.add(sentence);
}
for (const prompt of speaking) required.add(prompt.sampleAnswer);
const byText = new Map(manifest.clips.map(clip => [clip.text, clip]));
if (byText.size !== manifest.clips.length || byText.size !== required.size || [...required].some(text => !byText.has(text))) {
  throw new Error('Offline audio must cover the exact current lesson text; regenerate changed clips.');
}
const filenames = new Set();
for (const clip of manifest.clips) {
  if (!/^[a-f0-9]{20}\.mp3$/.test(clip.file) || clip.file !== digest(clip.text).slice(0,20) + '.mp3' || filenames.has(clip.file)) {
    throw new Error('Invalid offline audio filename or text hash');
  }
  filenames.add(clip.file);
  const bytes = await readFile(path.join(source, 'mp3', clip.file));
  if (bytes.length !== clip.bytes || digest(bytes) !== clip.sha256 || !(clip.durationSeconds > 0)) {
    throw new Error(`Corrupt offline audio: ${clip.file}`);
  }
}
const sourceFiles = await readdir(path.join(source, 'mp3'));
if (sourceFiles.length !== filenames.size || sourceFiles.some(name => !filenames.has(name))) throw new Error('Unexpected offline audio file');
if (!process.argv.includes('--check')) {
  await mkdir(target, {recursive:true});
  for (const file of filenames) await copyFile(path.join(source, 'mp3', file), path.join(target, file));
}
console.log(`Verified ${byText.size} native-only offline clips against current lesson text and SHA-256.`);
