import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const sideEffectImports = source => [...source.matchAll(/^import\s+['"]([^'"]+)['"];?\s*$/gm)].map(match => match[1]);

test('Web and Harmony share one explicitly ordered global style entry', async () => {
  const [web, mobile, wrapper, shared] = await Promise.all([
    read('app/layout.tsx'), read('mobile/src/main.tsx'), read('app/style-entry.ts'), read('app/style-entry.css'),
  ]);
  assert.deepEqual(sideEffectImports(web), ['./style-entry.css']);
  assert.deepEqual(sideEffectImports(mobile), ['../../app/style-entry']);
  assert.deepEqual(sideEffectImports(wrapper), ['./style-entry.css']);
  const cssImports = [...shared.matchAll(/^\s*@import\s+['"]([^'"]+)['"];\s*$/gm)].map(match => match[1]);
  assert.deepEqual(cssImports, [
    './globals.css',
    './redesign.css',
    './v041-design-theme.css',
    './learn/v041-vocabulary.css',
    './learn/audio-redesign.css',
    './v041-app-redesign.css',
    './learn/legal-pages.css',
  ]);
  assert.equal(shared.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*@import\s+['"][^'"]+['"];\s*$/gm, '').trim(), '', 'CSS entry must only order the existing stylesheets');
});
