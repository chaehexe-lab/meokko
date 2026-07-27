import { NextResponse } from "next/server";
import crmDashboard from "../../../data/crm-dashboard.json";

export async function GET() {
  return NextResponse.json(crmDashboard, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
