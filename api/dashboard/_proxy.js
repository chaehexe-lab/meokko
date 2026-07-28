const UPSTREAM_BASE = "https://ccomo-market-ai.aisprintteam2.chatgpt.site";

async function proxyDashboardRequest(request, response, pathname) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ error: "GET 요청만 지원합니다." });
    return;
  }

  try {
    const currentUrl = new URL(request.url, `https://${request.headers.host || "meokko.vercel.app"}`);
    const upstreamUrl = `${UPSTREAM_BASE}${pathname}${currentUrl.search}`;
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" }
    });
    const body = await upstreamResponse.text();

    response.setHeader("Cache-Control", upstreamResponse.headers.get("cache-control") || "public, max-age=60");
    response.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8");
    response.status(upstreamResponse.status).send(body);
  } catch (error) {
    response.status(502).json({ error: error.message || "대시보드 데이터 API 연결 실패" });
  }
}

module.exports = { proxyDashboardRequest };
