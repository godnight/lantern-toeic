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
  assert.match(html, /正在整理你的学习记录/);
  assert.match(html, /成长足迹/);
  // This is the production build, not the starter's obsolete preview-marker fixture.

});
