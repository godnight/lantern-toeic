'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = function loadCandidate() {
  const productRoot = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '../..');
  const ts = require(path.join(productRoot, 'node_modules/typescript'));
  const sourcePath = path.join(productRoot, 'lib/phone-verification.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { strict: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath, reportDiagnostics: true,
  });
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error('Candidate failed TypeScript transpilation');
  }
  const exports = {};
  // No require/process/fake is injected into the product module.
  vm.runInNewContext(result.outputText, { exports }, { filename: sourcePath });
  return exports;
};
