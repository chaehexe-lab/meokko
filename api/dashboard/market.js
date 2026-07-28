const { proxyDashboardRequest } = require("./_proxy");

module.exports = function handler(request, response) {
  return proxyDashboardRequest(request, response, "/api/dashboard/market");
};
