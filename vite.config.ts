import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

// Exact JSON leaves keep immutable teaching data below the static-asset cap.
// Retain Rolldown's dependency inclusion and automatic handling of other modules.
const privateDataCodeSplitting = {
  groups: [
    {name: "data-word-audio-bindings-v040", test: /[\\/]content[\\/]word-audio-bindings-v040\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-vocabulary-full4109-private", test: /[\\/]content[\\/]vocabulary-full4109-private\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-natural-audio-catalog-v1", test: /[\\/]content[\\/]natural-audio-catalog-v1\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-natural-audio-manifest", test: /[\\/]content[\\/]natural-audio-manifest\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-natural-audio-admission-v2", test: /[\\/]content[\\/]natural-audio-admission-v2\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-vocabulary-v040-b02-private", test: /[\\/]content[\\/]vocabulary-v040-b02-private\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-merged-memberships", test: /[\\/]content[\\/]wordlists[\\/]merged-memberships\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1}
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    build: {rolldownOptions: {output: {codeSplitting: privateDataCodeSplitting}}},
    cacheDir: ".sites-runtime/vite-cache",
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
