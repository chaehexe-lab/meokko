const GITHUB_PAGES_ORIGIN = "https://chaehexe-lab.github.io";

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== GITHUB_PAGES_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": GITHUB_PAGES_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export function corsOptions(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
