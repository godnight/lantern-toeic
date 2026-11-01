// Small allowlist, conservative fallback. No package installation is needed.
import {appendFileSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const metadata = new Set(['harmony/AppScope/app.json5', 'release-manifest.json', 'public/build-identity.json', 'package.json', 'mobile/package.json']);
const toolingPaths = new Set(['.github/scripts/change-scope.mjs', '.github/tests/change-scope.test.mjs', '.github/tests/workflows.test.mjs']);
const vocabularyPaths = new Set(['app/learn/vocabulary-plan.tsx', 'app/learn/v041-vocabulary.css', 'app/learn/word-card-reference.ts', 'content/word-card-reference.json', 'content/word-card-phonetic-supplement.json', 'scripts/build-word-card-reference.py', 'tests/phase2-vocabulary-ui.test.cjs', 'tests/browser/word-card-layout.cjs', 'tests/browser/word-card-layout.fixture.jsx']);
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const semver = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const sameReleaseLine = (before, after) => semver(before) && semver(after) && before.split('.').slice(0, 2).join('.') === after.split('.').slice(0, 2).join('.') && Number(after.split('.')[2]) >= Number(before.split('.')[2]);
const versionCode = value => Number.isSafeInteger(value) && value > 0;
const docPath = value => typeof value === 'string' && /^docs\/(?:[\w.-]+\/)*[\w.-]+\.md$/.test(value) && !value.split('/').includes('..');
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

export function versionOnly(path, beforeText, afterText) {
  try {
    // JSON5 syntax outside the current strict-JSON AppScope file falls back to full.
    const before = JSON.parse(beforeText), after = JSON.parse(afterText);
    if (path === 'harmony/AppScope/app.json5') {
      return isDeepStrictEqual(omit(before, ['app']), omit(after, ['app'])) &&
        sameReleaseLine(before.app.versionName, after.app.versionName) &&
        versionCode(before.app.versionCode) && versionCode(after.app.versionCode) && after.app.versionCode >= before.app.versionCode &&
        isDeepStrictEqual(omit(before.app, ['versionName', 'versionCode']), omit(after.app, ['versionName', 'versionCode']));
    }
    if (path === 'release-manifest.json') {
      return sameReleaseLine(before.version, after.version) && docPath(after.notes) && docPath(after.qa) &&
        isDeepStrictEqual(omit(before, ['version', 'notes', 'qa']), omit(after, ['version', 'notes', 'qa']));
    }
    if (path === 'public/build-identity.json') {
      const identity = value => value.schemaVersion === 1 && value.excludedSelf === path &&
        typeof value.buildId === 'string' && /^[\w.-]+$/.test(value.buildId) &&
        /^[a-f0-9]{64}$/.test(value.sourceInputsSha256) && Number.isSafeInteger(value.inputCount) && value.inputCount > 0 && versionCode(value.versionCode);
      return identity(before) && identity(after) && sameReleaseLine(before.versionName, after.versionName) && after.versionCode >= before.versionCode &&
        isDeepStrictEqual(omit(before, ['buildId', 'sourceInputsSha256', 'inputCount', 'versionName', 'versionCode']), omit(after, ['buildId', 'sourceInputsSha256', 'inputCount', 'versionName', 'versionCode']));
    }
    return sameReleaseLine(before.version, after.version) && isDeepStrictEqual(omit(before, ['version']), omit(after, ['version']));
  } catch {
    return false;
  }
}

function plan(full, ui, tooling, reasons, {themeWeb = false, signing = false, vocabularyUi = false} = {}) {
  return {level: full ? 'full' : ui || vocabularyUi ? 'ui' : tooling ? 'tooling' : 'docs', full, ui: ui && !full, tooling, harmony: full, theme_web: themeWeb && !full, vocabulary_ui: vocabularyUi && !full, signing, reasons};
}

export function classifyChanges(changes, readVersions) {
  let full = false, ui = false, tooling = false, themeWeb = false, signing = false, vocabularyUi = false;
  const reasons = [];
  for (const {path, status} of changes) {
    if (/^(?:README(?:\.[\w-]+)?\.md|AGENTS\.md|LICENSE(?:\.md|\.txt)?)$/.test(path) || /^docs\/.+\.(?:md|txt)$/.test(path) || path === '.github/pull_request_template.md') continue;
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) || toolingPaths.has(path)) { tooling = true; continue; }
    if (path.startsWith('tools/harmony-release/')) { tooling = true; signing = true; continue; }
    if (status === 'M' && path === 'tests/browser/theme-browser.cjs') { tooling = true; themeWeb = true; continue; }
    if ((status === 'A' || status === 'M') && vocabularyPaths.has(path)) { vocabularyUi = true; continue; }
    if (status === 'M' && metadata.has(path) && versionOnly(path, ...readVersions(path))) continue;
    if ((status === 'A' || status === 'M') && (path === 'app/learn/today-dashboard.tsx' || /^(?:app|components)\/.+\.css$/.test(path))) {
      ui = true;
      continue;
    }
    full = true;
    reasons.push(`full: ${status} ${path}`);
  }
  return plan(full, ui, tooling, reasons.length ? reasons : ['Only allowlisted documentation, presentation UI, targeted tooling or version metadata changed.'], {themeWeb, signing, vocabularyUi});
}

export function planForEvent({cwd, eventName, event}) {
  if (eventName !== 'pull_request') return plan(true, false, false, ['Main push, manual full run or unrecognized event.']);
  const base = event.pull_request?.base?.sha, head = event.pull_request?.head?.sha;
  if (![base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40,64}$/.test(sha))) {
    return plan(true, false, false, ['Missing PR base/head SHA.']);
  }
  for (const sha of [base, head]) {
    try { git(cwd, 'cat-file', '-e', `${sha}^{commit}`); }
    catch { return plan(true, false, false, ['PR base/head commit unavailable; use full checks.']); }
  }
  let mergeBase;
  try { mergeBase = git(cwd, 'merge-base', base, head).trim(); }
  catch { return plan(true, false, false, ['No PR merge base; use full checks.']); }
  // --no-renames deliberately reports a rename as deletion + addition, so an old
  // high-risk path cannot disappear behind a new documentation/UI filename.
  const fields = git(cwd, 'diff', '--name-status', '-z', '--no-renames', mergeBase, head, '--').split('\0');
  if (fields.pop() !== '' || fields.length % 2 !== 0) throw new Error('Malformed git diff output');
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index], path = fields[index + 1];
    if (!/^[AMDT]$/.test(status) || !path) throw new Error('Unsupported git diff entry');
    changes.push({status, path});
  }
  // Unexpected git/show/read errors propagate: a broken classifier must fail CI.
  return {...classifyChanges(changes, path => [git(cwd, 'show', `${mergeBase}:${path}`), git(cwd, 'show', `${head}:${path}`)]), mergeBase, changedFiles: changes.length};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = planForEvent({cwd: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))});
  const outputs = ['level', 'full', 'ui', 'tooling', 'harmony', 'theme_web', 'signing', 'vocabulary_ui'].map(key => `${key}=${result[key]}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `CI scope: **${result.level}**${result.mergeBase ? ` (PR merge base ${result.mergeBase.slice(0, 12)})` : ''}.\n\n${result.reasons.map(reason => `- ${reason}`).join('\n')}\n`);
}
