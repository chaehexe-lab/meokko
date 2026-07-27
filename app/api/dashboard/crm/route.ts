import { NextResponse } from "next/server";
import { corsHeaders, corsOptions } from "../../../lib/cors";
import crmDashboard from "../../../data/crm-dashboard.json";

export function OPTIONS(request: Request) {
  return corsOptions(request);
}

export async function GET(request: Request) {
  return NextResponse.json(crmDashboard, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=86400",
      ...corsHeaders(request),
    },
  });
}
