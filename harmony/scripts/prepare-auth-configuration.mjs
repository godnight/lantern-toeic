// Prepare build-owned, non-secret account routing in an isolated source copy.
// This does not configure a service, sign a package, or touch a device.
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const sourceRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const configurationPath = 'harmony/entry/src/main/ets/auth/AuthConfiguration.ets';
const storePath = 'harmony/entry/src/main/ets/auth/AuthSessionStore.ets';

function fail() { throw new Error('Invalid or unsafe account build configuration'); }

function inGitCheckout(path) {
  let dir = path;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function inside(root, path) {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

export function renderAuthConfiguration(config, template = readFileSync(join(sourceRoot, ...configurationPath.split('/')), 'utf8')) {
  if (config === null || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).sort().join(',') !== 'apiOrigin,schemaVersion,sessionAlias' ||
      config.schemaVersion !== 1 || typeof config.apiOrigin !== 'string' ||
      typeof config.sessionAlias !== 'string') fail();
  const origin = config.apiOrigin;
  const alias = config.sessionAlias;
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/.test(origin) ||
      origin === 'https://lantern.local' || !/^[a-zA-Z0-9._-]{1,128}$/.test(alias)) fail();
  const url = new URL(origin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.port && Number(url.port) > 65535)) fail();
  if (typeof template !== 'string') fail();
  let result = template;
  for (const [name, value] of [['AUTH_API_ORIGIN', origin], ['AUTH_SESSION_ALIAS', alias]]) {
    const line = new RegExp(`^export const ${name}: string = '[^'\\r\\n]*';\\r?$`, 'gm');
    if ([...result.matchAll(line)].length !== 1) fail();
    result = result.replace(line, `export const ${name}: string = '${value}';`);
  }
  return result;
}

export function prepareAuthConfiguration(configFile, stagingDirectory) {
  const configPath = realpathSync(configFile);
  const stage = realpathSync(stagingDirectory);
  if (!lstatSync(configFile).isFile() || !lstatSync(stagingDirectory).isDirectory() ||
      inGitCheckout(dirname(configPath)) || inGitCheckout(stage) || stage === sourceRoot ||
      inside(sourceRoot, stage) || inside(sourceRoot, configPath)) fail();
  const target = join(stage, ...configurationPath.split('/'));
  if (!lstatSync(target).isFile() || !inside(stage, realpathSync(target))) fail();
  const store = join(stage, ...storePath.split('/'));
  if (!lstatSync(store).isFile() || !inside(stage, realpathSync(store)) ||
      readFileSync(store, 'utf8') !== readFileSync(join(sourceRoot, ...storePath.split('/')), 'utf8')) fail();
  const expected = readFileSync(join(sourceRoot, ...configurationPath.split('/')), 'utf8');
  if (readFileSync(target, 'utf8') !== expected) fail();
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const generated = renderAuthConfiguration(config);
  const temp = join(dirname(target), `.auth-config-${randomBytes(12).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, generated, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temp, target);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function main(args) {
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--staging-root') fail();
  prepareAuthConfiguration(args[1], args[3]);
  process.stdout.write('Account build configuration prepared in isolated staging.\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); } catch {
    process.stderr.write('Account build configuration was not prepared.\n');
    process.exitCode = 1;
  }
}
