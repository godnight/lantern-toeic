import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, 'reports/offline-audio'));
const digest = value => createHash('sha256').update(value).digest('hex');
const sources = {};
for (const name of ['questions', 'speaking']) {
  const bytes = await readFile(path.join(root, 'content', `${name}.json`));
  sources[name] = { path: `content/${name}.json`, sha256: digest(bytes), data: JSON.parse(bytes.toString('utf8')) };
}
const byText = new Map();
const byName = new Map();
function add(text, reference) {
  if (typeof text !== 'string' || text.length === 0) return;
  const textSha256 = digest(Buffer.from(text, 'utf8'));
  const filename = `${textSha256.slice(0, 20)}.mp3`;
  if (byName.has(filename) && byName.get(filename) !== text) throw Error(`Hash prefix collision: ${filename}`);
  byName.set(filename, text);
  if (!byText.has(text)) byText.set(text, { text, textSha256, filename, references: [] });
  byText.get(text).references.push(reference);
}
for (const question of sources.questions.data) {
  if (question.part >= 1 && question.part <= 4) {
    add(question.audioText || question.transcript || question.prompt, { kind: 'listening', id: question.id, part: question.part });
  }
  const transcript = question.transcript || question.audioText || '';
  transcript.split(/(?<=[.!?])\s+/).filter(Boolean).forEach((text, index) => {
    add(text, { kind: 'sentence', id: question.id, part: question.part, index });
  });
}
for (const prompt of sources.speaking.data) add(prompt.sampleAnswer, { kind: 'sampleAnswer', id: prompt.id });
const entries = [...byText.values()].sort((a, b) => a.filename.localeCompare(b.filename));
const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourceFiles: Object.fromEntries(Object.entries(sources).map(([name, item]) => [name, { path: item.path, sha256: item.sha256 }])),
  textPolicy: 'Exact source strings; no whitespace, punctuation or pronunciation normalization. Sentence splitting matches practice.tsx /(?<=[.!?])\\s+/.',
  voice: { engine: 'System.Speech / Windows SAPI', name: 'Microsoft Zira Desktop', locale: 'en-US', rate: 0, volume: 100 },
  format: { container: 'MP3', channels: 1, bitrateKbps: 64, sampleRateHz: 22050 },
  entries
};
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'inputs.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ uniqueTexts: entries.length, references: entries.reduce((n, entry) => n + entry.references.length, 0), totalCharacters: entries.reduce((n, entry) => n + entry.text.length, 0), output: path.join(output, 'inputs.json') }));
