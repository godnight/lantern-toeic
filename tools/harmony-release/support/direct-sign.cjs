// Original encrypted configuration is read only; secrets stay in memory/anonymous stdin.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const options = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let secrets = [];
function redact(value) {
  let result = String(value);
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[REDACTED]');
  return result;
}
(async () => {
  const config = JSON.parse(fs.readFileSync(options.originalProfile, 'utf8'));
  const selected = config.app.products.filter(x => x.name === 'default');
  if (selected.length !== 1) throw Error('PRODUCT_NOT_UNIQUE');
  const configs = config.app.signingConfigs.filter(x => x.name === selected[0].signingConfig);
  if (configs.length !== 1) throw Error('SIGNER_NOT_UNIQUE');
  const m = configs[0].material;
  secrets = [m.storePassword, m.keyPassword];
  const Module = require('module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function(name, ...rest) {
    return resolve.call(this, name === '@ohos/hvigor' ? options.hvigorIndex : name, ...rest);
  };
  process.env.NODE_PATH = options.hvigorModules;
  Module._initPaths();
  const { DecipherUtil } = require(options.decipher);
  const store = DecipherUtil.decryptPwd(path.dirname(m.storeFile), m.storePassword, options.originalProfile);
  const key = DecipherUtil.decryptPwd(path.dirname(m.storeFile), m.keyPassword, options.originalProfile);
  secrets.push(store, key);
  const args = ['--class-path', options.jar, options.bridge, 'sign-app', '-mode', 'localSign',
    '-keyAlias', m.keyAlias, '-appCertFile', m.certpath, '-profileFile', m.profile,
    '-inFile', options.unsigned, '-signAlg', m.signAlg, '-keystoreFile', m.storeFile,
    '-outFile', options.signed];
  const result = await new Promise((resolve, reject) => {
    const child = cp.spawn(options.java, args, {env: options.env, windowsHide: true, stdio: ['pipe','pipe','pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', x => stdout += x.toString());
    child.stderr.on('data', x => stderr += x.toString());
    child.on('error', reject);
    child.on('close', code => resolve({code, stdout, stderr}));
    child.stdin.end(Buffer.from(store).toString('base64') + '\n' + Buffer.from(key).toString('base64') + '\n');
  });
  fs.writeFileSync(options.log, redact(result.stdout + '\n' + result.stderr), {flag:'wx'});
  process.stdout.write(JSON.stringify({exitCode:result.code, outputExists:fs.existsSync(options.signed),
    passwordArgv:false, originalEncryptedChannel:true}) + '\n');
  process.exitCode = result.code === 0 && fs.existsSync(options.signed) ? 0 : 1;
})().catch(error => {
  process.stderr.write('DIRECT_SIGN_FAILED:' + redact(error && error.code || 'SIGNER_ERROR') + '\n');
  process.exitCode = 1;
});
