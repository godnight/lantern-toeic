// Dependency-free guardrails for the fast/full boundaries. GitHub parses YAML;
// a local edit also gets a full YAML parse with the repository's existing parser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const workflow = name => readFileSync(new URL(`../workflows/${name}.yml`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const steps = source => source.split(/^      - /m).slice(1);

test('both required checks always start and classify the complete PR history before expensive steps', () => {
  for (const [name, job] of [['core', 'core-validation'], ['harmony-web', 'shared-assets']]) {
    const source = workflow(name);
    assert.match(source, new RegExp(`^  ${job}:$`, 'm'));
    assert.match(source, /^  pull_request:$/m);
    assert.doesNotMatch(source, /^\s+paths(?:-ignore)?:/m);
    assert.match(source, /fetch-depth: 0/);
    assert.doesNotMatch(source, /continue-on-error:|\|\| true/);
    const allSteps = steps(source);
    assert.match(allSteps[0], /actions\/checkout/);
    assert.match(allSteps[1], /id: scope\n\s+run: node \.github\/scripts\/change-scope\.mjs/);
    for (const step of allSteps.slice(2)) assert.match(step, /\n        if: .*steps\.scope\.outputs\./, `${name}: expensive step lacks a scope guard`);
  }
});

test('full Core preserves broad regressions while presentation UI only runs type and component checks', () => {
  const allSteps = steps(workflow('core'));
  for (const command of ['bash scripts/codex-setup.sh', 'npm run build', 'poppler-utils', 'npm --prefix mobile run build', 'install --with-deps chromium', 'npm run test:browser', "sqlite3.connect(':memory:')"]) {
    const step = allSteps.find(step => step.includes(command) && /if: steps\.scope\.outputs\.full == 'true'/.test(step));
    assert.ok(step, `full regression missing: ${command}`);
    assert.match(step, /if: steps\.scope\.outputs\.full == 'true'/);
  }
  const uiSteps = allSteps.filter(step => /if: steps\.scope\.outputs\.ui == 'true'(?: \|\| steps\.scope\.outputs\.(?:theme_web|vocabulary_ui) == 'true')*\n/.test(step)).join('\n');
  assert.match(uiSteps, /npm ci/); assert.match(uiSteps, /npm run typecheck/);
  assert.match(uiSteps, /tests\/theme-atmosphere\.test\.cjs/);
  assert.doesNotMatch(uiSteps, /poppler|playwright|npm run build|sync:web|scripts\/codex-setup/);
});

test('signing tools install no product dependencies and the exact theme test uses its own Web fixture', () => {
  const allSteps = steps(workflow('core'));
  const signing = allSteps.find(step => step.includes('working-directory: tools/harmony-release'));
  assert.ok(signing); assert.match(signing, /outputs\.signing == 'true'/);
  assert.match(signing, /python3 -B test_verify_request\.py/);
  assert.match(signing, /python3 -B -m unittest test_entrypoint test_signed_payload/);
  assert.doesNotMatch(signing, /npm |hvigor/);
  assert.ok(allSteps.indexOf(signing) < allSteps.findIndex(step => step.includes('actions/setup-node')), 'tool checks precede product dependencies');
  const theme = allSteps.filter(step => /if: steps\.scope\.outputs\.theme_web == 'true'\n/.test(step)).join('\n');
  assert.match(theme, /npm run test:themes:web:browser/);
  assert.doesNotMatch(theme, /npm run build|sync:web|--prefix mobile/);
});

test('source releases are explicit-only and normal sync does not immediately repeat check:web', () => {
  const release = workflow('source-release');
  const triggers = release.split('\non:\n')[1].split('\npermissions:')[0];
  assert.equal(triggers.trim(), 'workflow_dispatch:');
  for (const name of ['harmony-web', 'source-release']) {
    assert.match(workflow(name), /npm --prefix harmony run sync:web/);
    assert.doesNotMatch(workflow(name), /npm --prefix harmony run check:web/);
  }
});


test('the word-card fast path checks its actual component and browser without the unrelated product matrix', () => {
  const selected = steps(workflow('core')).filter(step => /if: steps\.scope\.outputs\.vocabulary_ui == 'true'/.test(step)).join('\n');
  assert.match(workflow('core'), /if: steps\.scope\.outputs\.ui == 'true' \|\| steps\.scope\.outputs\.vocabulary_ui == 'true'\n\s+run: npm run typecheck/);
  assert.match(selected, /node --test tests\/phase2-vocabulary-ui\.test\.cjs/);
  assert.match(selected, /node tests\/browser\/word-card-layout\.cjs --reference-only/);
  assert.doesNotMatch(selected, /poppler|sync:web|--prefix mobile|test:dictionary|test:browser|codex-setup/);
});
