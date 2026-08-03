const crmSnapshot = require("./crm-snapshot.json");

module.exports = function handler(request, response) {
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

  response.setHeader("Cache-Control", "public, max-age=60");
  response.status(200).json(crmSnapshot);
};
