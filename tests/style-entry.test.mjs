import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const sideEffectImports = source => [...source.matchAll(/^import\s+['"]([^'"]+)['"];?\s*$/gm)].map(match => match[1]);

test('Web and Harmony share one explicitly ordered global style entry', async () => {
  const [web, mobile, shared] = await Promise.all([
    read('app/layout.tsx'), read('mobile/src/main.tsx'), read('app/style-entry.ts'),
  ]);
  for (const [source, entry] of [[web, './style-entry'], [mobile, '../../app/style-entry']]) {
    const imports = sideEffectImports(source);
    assert.equal(imports.filter(specifier => specifier === entry).length, 1);
    assert.equal(imports.filter(specifier => specifier.endsWith('.css')).length, 0);
  }
  assert.deepEqual(sideEffectImports(shared), [
    './globals.css',
    './redesign.css',
    './v041-design-theme.css',
    './learn/v041-vocabulary.css',
    './learn/audio-redesign.css',
    './v041-app-redesign.css',
    './learn/legal-pages.css',
  ]);
});
