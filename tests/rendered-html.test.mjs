import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the CCOMO market dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>꼬모 시장분석 AI<\/title>/i);
  assert.match(html, /CCOMO MARKET INTELLIGENCE/);
  assert.match(html, /시장 데이터/);
  assert.match(html, /CRM 실데이터 인사이트/);
});

test("connects the public market-reaction surface to its API", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market-reaction/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /fetch\("\/api\/market-reaction"/);
  assert.match(page, /캐릭터 냉장고 온라인 공개 반응/);
  assert.match(route, /v1\/search\/\$\{source\}\.json/);
  assert.match(route, /광고성 문구·실사용 후기를 제외/);
  assert.match(route, /NAVER_TREND_CLIENT_ID/);
});
