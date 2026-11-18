// Explicit invocation and root-controlled config only. Candidate: not a
// deployment, installer, migration, public listener, or production approval.
import { manageRunner } from './runner-lifecycle.candidate.mjs';
import { startNativeAccountGateway } from './native-account-runtime.candidate.mjs';

if (process.argv.length !== 5 || process.argv[2] !== '--enable' || process.argv[3] !== '--config') {
  console.error('explicit enable and protected native account configuration required');
  process.exitCode = 1;
} else {
  const runner = manageRunner({ enabled: true, events: process,
    start: () => startNativeAccountGateway({ enabled: true, file: process.argv[4] }),
    onError: () => { console.error('native account shutdown failed'); process.exitCode = 1; },
  });
  try { await runner.started; if (!runner.requested) console.log('native account candidate ready'); }
  catch { console.error('native account startup failed'); process.exitCode = 1; }
}
