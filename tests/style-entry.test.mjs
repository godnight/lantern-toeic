import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const sideEffectImports = source => [...source.matchAll(/^import\s+['"]([^'"]+)['"];?\s*$/gm)].map(match => match[1]);

const expectedStyles = [
  './globals.css',
  './redesign.css',
  './v041-design-theme.css',
  './learn/v041-vocabulary.css',
  './learn/audio-redesign.css',
  './v041-app-redesign.css',
  './learn/legal-pages.css',
];

test('Hosted and Harmony preserve the same explicitly ordered global styles', async () => {
  const [web, mobile, shared] = await Promise.all([
    read('app/layout.tsx'), read('mobile/src/main.tsx'), read('app/style-entry.ts'),
  ]);
  assert.deepEqual(sideEffectImports(web), expectedStyles, 'Hosted CSS must be directly discoverable by the framework');
  assert.deepEqual(sideEffectImports(shared), expectedStyles, 'Harmony must retain its original CSS compilation path');
  assert.deepEqual(sideEffectImports(mobile), ['../../app/style-entry'], 'Harmony must use the existing shared entry');
});
