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
        "당신은 꼬모냉장고 마케팅 분석 AI입니다.",
        "입력받은 데이터(타깃 분석, 키워드 분석, 감성 분석)를 종합하여 대시보드 상단에 표시될 종합 인사이트를 작성합니다.",
        "입력 데이터에 없는 내용을 임의로 생성하지 않습니다.",
        "주목받고 있다, 인기다, 성장 중이다처럼 데이터로 직접 확인되지 않은 표현을 쓰지 않습니다.",
        "느낌표를 쓰지 않습니다.",
        "제품명은 항상 꼬모냉장고를 사용합니다.",
        "자연스럽고 마케팅 전략처럼 작성합니다.",
        "출력은 JSON 객체 하나만 반환한다. 마크다운 코드블록은 쓰지 않는다."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        "아래 dashboardData만 근거로 종합 인사이트를 작성해.",
        "",
        "# 가장 중요한 규칙",
        "1. keywordRanking의 1위 키워드는 반드시 headline 문장에 자연스럽게 포함한다.",
        "2. sentimentRatios에서 가장 높은 비율의 감성을 기준으로 작성한다.",
        "3. 선택된 감성의 keywordRanking 1위도 반드시 headline 문장에 포함한다.",
        "4. existingCustomer와 prospectCustomer가 같으면 반드시 existingCustomer 값을 글자 그대로 한 번 쓰고, keywordRank1과 반응 키워드를 활용해 핵심 타깃 집중 문장으로 작성한다.",
        "5. existingCustomer와 prospectCustomer가 다르면 반드시 existingCustomer 값, existingCustomerCenterStrategy 값, prospectCustomer 값, keywordRank1 값을 포함한다.",
        "6. 기존 고객과 잠재 고객이 다르면 반드시 '기존고객인 [existingCustomer]의 '[existingCustomerCenterStrategy]' 중심 전략을 유지하면서, [prospectCustomer]의 '[keywordRank1] ...' 니즈를 반영...' 구조로 작성한다.",
        "7. 긍정이 가장 높으면 강점 강화 중심으로 작성한다.",
        "8. 부정이 가장 높으면 keywordRank1과 positiveKeywordRank1의 강점은 유지하면서 negativeKeywordRank1 등 주요 불만 요소를 개선하는 방향으로 작성한다.",
        "9. 중립이 가장 높으면 keywordRank1과 positiveKeywordRank1의 활용성과 차별점을 전달하는 방향으로 작성한다.",
        "10. 1~2문장으로 작성한다.",
        "11. 설명, 근거 나열, 마크다운은 출력하지 않는다.",
        "12. 문장은 '~마케팅이 필요합니다', '~확장하는 것이 효과적입니다', '~전달하는 전략이 필요합니다' 중 하나의 톤으로 끝낸다.",
        "13. 새로운 사용 상황, 채널, 효과, 성과를 만들지 않는다.",
        "",
        "# 문장 예시 구조",
        "기존 고객과 잠재 고객이 같은 경우/긍정: 꼬모냉장고의 핵심 고객은 '[existingCustomer]'이며, '[keywordRank1] 및 [topSentiment.keywordRank1]'으로의 마케팅 집중이 필요합니다.",
        "기존 고객과 잠재 고객이 같은 경우/부정: [existingCustomer]을 핵심 타깃으로 하되, '[keywordRank1]'과 '[positiveKeywordRank1]'의 강점은 유지하면서 [negativeKeywordRank1] 등 주요 불만 요소를 개선하는 마케팅이 필요합니다.",
        "기존 고객과 잠재 고객이 같은 경우/중립: [existingCustomer]을 핵심 타깃으로, '[keywordRank1]'과 '[positiveKeywordRank1]'의 활용성과 차별점을 효과적으로 전달하는 마케팅이 필요합니다.",
        "기존 고객과 잠재 고객이 다른 경우/긍정: 기존고객인 [existingCustomer]의 '[existingCustomerCenterStrategy]' 중심 전략을 유지하면서, [prospectCustomer]의 '[keywordRank1]·[topSentiment.keywordRank1]' 니즈를 반영한 마케팅으로 확장하는 것이 효과적입니다.",
        "기존 고객과 잠재 고객이 다른 경우/부정: [existingCustomer]의 '[existingCustomerCenterStrategy]' 중심 전략을 유지하면서, [prospectCustomer]의 '[keywordRank1]' 니즈를 반영하되, [negativeKeywordRank1] 등 주요 불만 요소를 개선한 마케팅으로 확장하는 것이 효과적입니다.",
        "기존 고객과 잠재 고객이 다른 경우/중립: [existingCustomer]의 '[existingCustomerCenterStrategy]' 중심 전략을 유지하면서, [prospectCustomer]의 '[keywordRank1]' 니즈를 이해할 수 있도록 활용성과 차별점을 전달하는 마케팅으로 확장하는 것이 효과적입니다.",
        "",
        "# 출력 형식",
        "반드시 다음 키만 가진 JSON 객체로 답해: headline.",
        "headline 값에는 종합 인사이트 문장만 넣는다.",
        "",
        "# 참고",
        "dashboardData.insightRulesInput.keywordRank1은 전체 키워드 순위 1위다.",
        "dashboardData.insightRulesInput.topSentiment.type은 가장 높은 감성이다.",
        "dashboardData.insightRulesInput.topSentiment.keywordRank1은 선택된 감성의 1위 키워드다.",
        "dashboardData.insightRulesInput.existingCustomer, existingCustomerCenterStrategy, prospectCustomer는 수정하거나 합쳐 쓰지 말고 그대로 사용한다.",
        "",
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
  insight = enforceInsightRules(payload, insight);
  sendJson(response, 200, { model, insight });
}

function enforceInsightRules(payload, insight) {
  const rules = payload?.insightRulesInput;
  if (!rules) return insight;

  const existingCustomer = rules.existingCustomer;
  const existingCustomerCenterStrategy = rules.existingCustomerCenterStrategy || "기존 고객";
  const prospectCustomer = rules.prospectCustomer;
  const keywordRank1 = rules.keywordRank1;
  const sentimentType = rules.topSentiment?.type;
  const sentimentKeyword = rules.topSentiment?.keywordRank1;
  const positiveKeyword = rules.positiveKeywordRank1 || sentimentKeyword;
  const negativeKeyword = rules.negativeKeywordRank1 || sentimentKeyword;
  let corrected;

  if (rules.isSameCustomer) {
    if (sentimentType === "부정" || sentimentType === "부정/우려") {
      corrected = `${existingCustomer}을 핵심 타깃으로 하되, '${keywordRank1}'과 '${positiveKeyword}'의 강점은 유지하면서 ${negativeKeyword} 등 주요 불만 요소를 개선하는 마케팅이 필요합니다.`;
    } else if (sentimentType === "중립") {
      corrected = `${existingCustomer}을 핵심 타깃으로, '${keywordRank1}'과 '${positiveKeyword}'의 활용성과 차별점을 효과적으로 전달하는 마케팅이 필요합니다.`;
    } else {
      corrected = `꼬모냉장고의 핵심 고객은 '${existingCustomer}'이며, '${keywordRank1} 및 ${sentimentKeyword}'으로의 마케팅 집중이 필요합니다.`;
    }
  } else if (sentimentType === "부정" || sentimentType === "부정/우려") {
    corrected = `${existingCustomer}의 '${existingCustomerCenterStrategy}' 중심 전략을 유지하면서, ${prospectCustomer}의 '${keywordRank1}' 니즈를 반영하되, ${negativeKeyword} 등 주요 불만 요소를 개선한 마케팅으로 확장하는 것이 효과적입니다.`;
  } else if (sentimentType === "중립") {
    corrected = `${existingCustomer}의 '${existingCustomerCenterStrategy}' 중심 전략을 유지하면서, ${prospectCustomer}의 '${keywordRank1}' 니즈를 이해할 수 있도록 활용성과 차별점을 전달하는 마케팅으로 확장하는 것이 효과적입니다.`;
  } else {
    corrected = `기존고객인 ${existingCustomer}의 '${existingCustomerCenterStrategy}' 중심 전략을 유지하면서, ${prospectCustomer}의 '${keywordRank1}·${sentimentKeyword}' 니즈를 반영한 마케팅으로 확장하는 것이 효과적입니다.`;
  }

  return { ...insight, headline: corrected };
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
