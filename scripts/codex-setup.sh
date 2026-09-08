#!/usr/bin/env bash
# Codex cloud setup, local checkout initialization, and Core CI use this entrypoint.
set -euo pipefail

lantern_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${lantern_repo_root}"

command -v node >/dev/null || { echo 'Node.js >=22.13.0 is required.' >&2; exit 69; }
command -v npm >/dev/null || { echo 'npm is required.' >&2; exit 69; }
node --input-type=commonjs <<'NODE'
const current = process.versions.node.split('.').map(Number);
const minimum = [22, 13, 0];
const different = current.findIndex((part, index) => part !== minimum[index]);
if (different !== -1 && current[different] < minimum[different]) {
  console.error(`Node.js >=22.13.0 is required; found ${process.versions.node}.`);
  process.exit(69);
}
NODE

# Root typechecking includes mobile/capacitor.config.ts, so both installs are needed.
npm ci --no-fund --no-audit
npm --prefix mobile ci --no-fund --no-audit
npm run typecheck
npm run validate:content
npm run validate:art
npm run test:study
echo 'LANTERN dependencies and core checks are ready. See docs/CODEX_HANDOFF.md for builds and remaining platform requirements.'
