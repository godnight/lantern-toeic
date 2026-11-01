import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./helpers/cloudflare-test-loader.mjs", import.meta.url);

test("renders the production learning shell and install metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>LANTERN · 微光托业<\/title>/);
  assert.match(html, /<html[^>]*lang="zh-CN"/);
  assert.match(html, /<link(?=[^>]*rel="manifest")(?=[^>]*href="\/manifest.webmanifest")[^>]*>/);
  // SSR has no device first-run inventory and this fixture has no account.
  // The real client must verify those gates before mounting a learning partition.
  assert.match(html, /<h1[^>]*>微光账号<\/h1>/);
  assert.match(html, /role="status"[^>]*>正在确认账号，请稍候。<\/p>/);
  assert.doesNotMatch(html, /自然音频目录仍在核验|学习内容仍在核验|VocabularyCatalogPendingError|StudyContentPendingError/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.doesNotMatch(html, /aria-label="桌面主导航"/);
  assert.doesNotMatch(html, /aria-label="手机主导航"/);
  assert.doesNotMatch(html, /id="workspace-main"/);
  assert.doesNotMatch(html, /lantern-v1-usr_|正在读取学习记录/);
  // This is the production build, not the starter's obsolete preview-marker fixture.

});
