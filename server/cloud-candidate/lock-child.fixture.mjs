import { acquireD1Lock } from './d1-lock.candidate.mjs';
await acquireD1Lock(process.argv[2]);
process.stdout.write('locked\n');
setInterval(() => {}, 1000);
