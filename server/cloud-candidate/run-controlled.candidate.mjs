// Explicit invocation only. This candidate is not a deployment or installer.
import { readRunnerConfig } from './runner-config.candidate.mjs';
import { manageRunner } from './runner-lifecycle.candidate.mjs';
import { startLockedGateway } from './locked-service.candidate.mjs';

if (process.argv.length !== 5 || process.argv[2] !== '--enable' || process.argv[3] !== '--config') {
  console.error('explicit enable and protected configuration required');
  process.exitCode = 1;
} else {
  const runner = manageRunner({ enabled: true, events: process,
    start: async () => startLockedGateway(await readRunnerConfig({ enabled: true, file: process.argv[4] })),
    onError: () => { console.error('cloud service shutdown failed'); process.exitCode = 1; },
  });
  try { await runner.started; if (!runner.requested) console.log('cloud service ready'); }
  catch { console.error('cloud service startup failed'); process.exitCode = 1; }
}
