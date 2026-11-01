/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database; BUCKET: R2Bucket; ASSETS: Fetcher;
    LANTERN_SITES_LEGACY_READONLY_ENABLED?: string;
    LANTERN_SITES_LEGACY_ORIGIN?: string;
  }
}
