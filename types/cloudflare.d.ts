/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env { DB: D1Database; BUCKET: R2Bucket; ASSETS: Fetcher; LANTERN_AUTH_ENABLED?:string; LANTERN_AUTH_ORIGIN?:string }
}
