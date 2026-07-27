import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, corsOptions } from "../../../lib/cors";
import { credentials, lastCompleteDayRange, naverPost } from "../../../lib/naver-api";

type TrendPoint = { period: string; ratio: number };
type TrendResponse = { results?: { title?: string; data?: TrendPoint[] }[] };

const CANDIDATES = ["화장품 냉장고", "음료 냉장고", "술 냉장고", "와인 냉장고", "원룸 냉장고"];
const SEARCH_AGES: Record<string, string[]> = {
  "10": ["2"],
  "20": ["3", "4"],
  "30": ["5", "6"],
  "40": ["7", "8"],
  "50": ["9", "10"],
  "50plus": ["9", "10", "11"],
  "60": ["11"],
};

function dailyChange(points: TrendPoint[]) {
  const values = points.map((point) => Number(point.ratio || 0));
  const recent = values.at(-1) || 0;
  const previous = values.at(-2) || 0;
  return previous ? Math.round(((recent - previous) / previous) * 100) : recent ? 100 : 0;
}

export function OPTIONS(request: Request) {
  return corsOptions(request);
}

export async function GET(request: NextRequest) {
  const age = request.nextUrl.searchParams.get("age") || "20";
  const genderParam = request.nextUrl.searchParams.get("gender");
  const gender = genderParam === "m" || genderParam === "f" ? genderParam : undefined;
  const ageLabel = age === "50plus" ? "50대 이상" : `${age}대`;

  try {
    const credential = credentials("TREND");
    const period = lastCompleteDayRange(2);
    const response = await naverPost<TrendResponse>(
      "/search-trend/v1/search",
      "/v1/datalab/search",
      {
        ...period,
        keywordGroups: CANDIDATES.map((keyword) => ({
          groupName: keyword,
          keywords: [keyword],
        })),
        device: "",
        ...(gender ? { gender } : {}),
        ages: SEARCH_AGES[age] || SEARCH_AGES["20"],
      },
      credential,
    );

    const keywords = (response.data.results || [])
      .map((result) => ({
        keyword: result.title || "",
        change: dailyChange(result.data || []),
        recentIndex: Math.round(Number((result.data || []).at(-1)?.ratio || 0)),
      }))
      .sort((a, b) => b.recentIndex - a.recentIndex);

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        analysisDate: period.endDate,
        target: `${ageLabel}${gender ? ` ${gender === "f" ? "여성" : "남성"}` : ""}`,
        keywords,
        source: `${response.provider} 검색어 트렌드`,
        notice: "전날 하루의 검색지수로 순위를 계산하고 전전날 대비 변화를 표시하며 매일 자정 갱신됩니다.",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=86400",
          ...corsHeaders(request),
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "관심 키워드를 불러오지 못했습니다." },
      { status: 502, headers: corsHeaders(request) },
    );
  }
}
