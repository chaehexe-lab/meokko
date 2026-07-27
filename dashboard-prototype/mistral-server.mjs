import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5180);
const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("요청 데이터가 너무 큽니다."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function buildPrompt(payload) {
  return [
    {
      role: "system",
      content: [
        "너는 꼬모냉장고 마케팅 대시보드의 종합 인사이트를 작성하는 분석가다.",
        "반드시 사용자가 제공한 JSON 데이터 안에서만 판단한다.",
        "없는 수치, 없는 출처, 확인되지 않은 판매량은 절대 만들지 않는다.",
        "한국어로 짧고 관리자 대시보드에 바로 들어갈 문장만 작성한다.",
        "출력은 JSON 객체 하나만 반환한다. 마크다운 코드블록은 쓰지 않는다."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        "아래 dashboardData만 근거로 종합 인사이트를 작성해.",
        "반드시 다음 7개 키만 가진 JSON 객체로 답해: headline, summary, who, why, barrier, difference, position.",
        "headline은 한 문장으로 꼬모냉장고의 오늘 마케팅 방향을 압축해.",
        "summary는 한 문장으로 타겟층·반응·경쟁사 분석을 어떻게 종합했는지 설명해.",
        "who/why/barrier/difference/position도 작성하되, 현재 화면에는 headline과 summary가 우선 표시된다.",
        "dashboardData:",
        JSON.stringify(payload)
      ].join("\n")
    }
  ];
}

async function handleInsight(request, response) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    sendJson(response, 500, { error: "MISTRAL_API_KEY 환경변수가 없습니다." });
    return;
  }

  const rawBody = await readBody(request);
  const payload = JSON.parse(rawBody || "{}");
  const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: buildPrompt(payload)
    })
  });

  const data = await mistralResponse.json();
  if (!mistralResponse.ok) {
    sendJson(response, mistralResponse.status, {
      error: data?.message || data?.error?.message || "Mistral API 요청 실패"
    });
    return;
  }

  const content = data?.choices?.[0]?.message?.content || "{}";
  let insight;
  try {
    insight = JSON.parse(content);
  } catch {
    insight = { headline: content };
  }
  if (!insight.headline && insight.instruction?.headline) insight = insight.instruction;
  if (!insight.headline && insight.output?.headline) insight = insight.output;
  if (!insight.headline && insight.result?.headline) insight = insight.result;
  sendJson(response, 200, { model, insight });
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/insight") {
      await handleInsight(request, response);
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }
    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: error.message || "서버 오류" });
  }
}).listen(port, () => {
  console.log(`Meokko dashboard with Mistral proxy: http://localhost:${port}`);
});
