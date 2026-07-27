import { NextRequest, NextResponse } from "next/server";
import { credentials, lastCompleteMonthRange, naverPost } from "../../../lib/naver-api";

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

function recentChange(points: TrendPoint[]) {
  const values = points.map((point) => Number(point.ratio || 0));
  const recentValues = values.slice(-3);
  const previousValues = values.slice(-6, -3);
  const average = (items: number[]) => items.reduce((sum, value) => sum + value, 0) / Math.max(items.length, 1);
  const recent = average(recentValues);
  const previous = average(previousValues);
  return previous ? Math.round(((recent - previous) / previous) * 100) : 0;
}

export async function GET(request: NextRequest) {
  const age = request.nextUrl.searchParams.get("age") || "20";
  const genderParam = request.nextUrl.searchParams.get("gender");
  const gender = genderParam === "m" || genderParam === "f" ? genderParam : undefined;
  const ageLabel = age === "50plus" ? "50대 이상" : `${age}대`;

  try {
    const credential = credentials("TREND");
    const response = await naverPost<TrendResponse>(
      "/search-trend/v1/search",
      "/v1/datalab/search",
      {
        ...lastCompleteMonthRange(12),
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
        change: recentChange(result.data || []),
        recentIndex: Math.round(
          (result.data || []).slice(-3).reduce((sum, point) => sum + Number(point.ratio || 0), 0) /
            Math.max((result.data || []).slice(-3).length, 1),
        ),
      }))
      .sort((a, b) => b.recentIndex - a.recentIndex);

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        target: `${ageLabel}${gender ? ` ${gender === "f" ? "여성" : "남성"}` : ""}`,
        keywords,
        source: `${response.provider} 검색어 트렌드`,
        notice: "사전 선정한 후보 키워드 5개의 상대 검색 추이를 동일 조건에서 비교한 순위입니다.",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "관심 키워드를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
