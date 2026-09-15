#!/usr/bin/env bash
# Linux/WSL, official HarmonyOS Command Line Tools + Java + Python 3.
# Build the shared frontend first: npm --prefix harmony run sync:web
set -euo pipefail
lantern_project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lantern_clt="${LANTERN_HARMONY_CLT:?Set LANTERN_HARMONY_CLT to the official command-line-tools directory}"
lantern_output="${LANTERN_HARMONY_OUTPUT:-$lantern_project/build/offline}"
lantern_tmpbase="${LANTERN_HARMONY_TMPDIR:-/tmp}"
for lantern_tool in python3 java tar; do command -v "$lantern_tool" >/dev/null; done
test -x "$lantern_clt/bin/hvigorw"
test -x "$lantern_clt/bin/ohpm"
test -x "$lantern_clt/tool/node/bin/node"
test -d "$lantern_clt/sdk/default"
export DEVECO_SDK_HOME="$lantern_clt/sdk"
export DEVECO_NODE_HOME="$lantern_clt/tool/node"
export PATH="$DEVECO_NODE_HOME/bin:$lantern_clt/bin:$PATH"
node "$lantern_project/scripts/sync-web.mjs" --check
# This helper deliberately only builds unsigned offline packages.
python3 - "$lantern_project/build-profile.json5" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as source:
    profile = json.load(source)
if profile['app'].get('signingConfigs'):
    raise SystemExit('Use an unsigned source checkout; configure signing in a separate local project.')
PY
lantern_stage="$(mktemp -d "$lantern_tmpbase/lantern-harmony.XXXXXXXX")"
# A new, disposable directory avoids stale assets and Hvigor's non-ASCII path rejection.
python3 - "$lantern_stage" <<'PY'
import sys
if not sys.argv[1].isascii() or ' ' in sys.argv[1]:
    raise SystemExit('Set LANTERN_HARMONY_TMPDIR to an ASCII directory without spaces.')
PY
trap 'rm -rf -- "$lantern_stage"' EXIT
tar -C "$lantern_project" --exclude='./.hvigor' --exclude='./oh_modules' \
  --exclude='./build' --exclude='./entry/build' --exclude='./entry/oh_modules' \
  --exclude='./local.properties' --exclude='*.p12' --exclude='*.p7b' \
  --exclude='*.cer' --exclude='*.jks' --exclude='*.keystore' --exclude='*.pem' \
  --exclude='*.csr' --exclude='agconnect-services.json' -cf - . | tar -C "$lantern_stage" -xf -
mkdir -p "$lantern_output"
lantern_output="$(cd "$lantern_output" && pwd)"
(
  cd "$lantern_stage"
  ohpm install --all
  hvigorw --mode module -p product=default -p module=entry@default \
    -p buildMode=debug assembleHap --no-daemon --stacktrace
) 2>&1 | tee "$lantern_output/build.log"
lantern_hap="$lantern_stage/entry/build/default/outputs/default/entry-default-unsigned.hap"
python3 "$lantern_project/scripts/verify-hap.py" "$lantern_hap" \
  --web "$lantern_project/entry/src/main/resources/rawfile/web" \
  --report "$lantern_output/package-verification.json"
cp "$lantern_hap" "$lantern_output/entry-default-unsigned.hap"
printf 'Verified unsigned HAP: %s/entry-default-unsigned.hap\n' "$lantern_output"
