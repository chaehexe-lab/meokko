import { NextResponse } from "next/server";

type TrendPoint = { period: string; ratio: number; group?: string };
type TrendResult = { title?: string; data?: TrendPoint[] };
type NaverResponse = { results?: TrendResult[]; errorMessage?: string; message?: string };

const category = "50000003"; // 디지털/가전

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function naverPost(url: string, body: Record<string, unknown>, id: string, secret: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": id,
      "X-Naver-Client-Secret": secret,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = (await response.json()) as NaverResponse;
  if (!response.ok) throw new Error(data.errorMessage || data.message || `네이버 API 오류 (${response.status})`);
  return data;
}

function sumByGroup(data: TrendPoint[]) {
  return data.reduce<Record<string, number>>((totals, point) => {
    if (point.group) totals[point.group] = (totals[point.group] || 0) + point.ratio;
    return totals;
  }, {});
}

function percentages(totals: Record<string, number>) {
  const sum = Object.values(totals).reduce((total, value) => total + value, 0) || 1;
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / sum) * 100)]));
}

function averageIndexByGroup(data: TrendPoint[]) {
  const grouped = data.reduce<Record<string, { sum: number; count: number }>>((result, point) => {
    if (!point.group) return result;
    const current = result[point.group] || { sum: 0, count: 0 };
    result[point.group] = { sum: current.sum + point.ratio, count: current.count + 1 };
    return result;
  }, {});
  const averages = Object.fromEntries(Object.entries(grouped).map(([group, value]) => [group, value.sum / Math.max(value.count, 1)]));
  const max = Math.max(...Object.values(averages), 1);
  return Object.fromEntries(Object.entries(averages).map(([group, value]) => [group, Math.round((value / max) * 100)]));
}

export async function GET() {
  const trendId = process.env.NAVER_TREND_CLIENT_ID;
  const trendSecret = process.env.NAVER_TREND_CLIENT_SECRET;
  const shoppingId = process.env.NAVER_SHOPPING_CLIENT_ID;
  const shoppingSecret = process.env.NAVER_SHOPPING_CLIENT_SECRET;

  if (!trendId || !trendSecret || !shoppingId || !shoppingSecret) {
    return NextResponse.json({ error: "네이버 데이터 연결 정보가 없습니다." }, { status: 503 });
  }

  const end = new Date();
  end.setDate(0); // 진행 중인 이번 달을 제외한 직전 월 말
  const start = new Date(end);
  start.setMonth(start.getMonth() - 23, 1);
  const common = { startDate: dateString(start), endDate: dateString(end), timeUnit: "month" };
  const shoppingCommon = { ...common, category, keyword: "소형 냉장고", device: "", gender: "", ages: [] };

  try {
    const [search, shopping, gender, age] = await Promise.all([
      naverPost("https://openapi.naver.com/v1/datalab/search", {
        ...common,
        keywordGroups: [
          { groupName: "소형 냉장고", keywords: ["소형 냉장고", "미니 냉장고", "1인 냉장고"] },
          { groupName: "캐릭터 냉장고", keywords: ["캐릭터 냉장고", "꼬모 냉장고", "라인 냉장고"] },
        ],
      }, trendId, trendSecret),
      naverPost("https://openapi.naver.com/v1/datalab/shopping/category/keywords", {
        ...common,
        category,
        keyword: [
          { name: "소형 냉장고", param: ["소형 냉장고"] },
          { name: "미니 냉장고", param: ["미니 냉장고"] },
          { name: "캐릭터 냉장고", param: ["캐릭터 냉장고"] },
        ],
        device: "",
        gender: "",
        ages: [],
      }, shoppingId, shoppingSecret),
      naverPost("https://openapi.naver.com/v1/datalab/shopping/category/keyword/gender", shoppingCommon, shoppingId, shoppingSecret),
      naverPost("https://openapi.naver.com/v1/datalab/shopping/category/keyword/age", { ...shoppingCommon, ages: ["10", "20", "30", "40", "50", "60"] }, shoppingId, shoppingSecret),
    ]);

    const searchPoints = search.results?.[0]?.data || [];
    const shoppingPoints = shopping.results?.[0]?.data || [];
    const genderShare = percentages(sumByGroup(gender.results?.[0]?.data || []));
    const ageIndex = averageIndexByGroup(age.results?.[0]?.data || []);
    const keywordChanges = (shopping.results || []).map((result) => {
      const values = (result.data || []).map((point) => point.ratio);
      const recent = values.slice(-3).reduce((sum, value) => sum + value, 0) / Math.max(values.slice(-3).length, 1);
      const previous = values.slice(-6, -3).reduce((sum, value) => sum + value, 0) / Math.max(values.slice(-6, -3).length, 1);
      return { keyword: result.title || "키워드", change: previous ? Math.round(((recent - previous) / previous) * 100) : 0 };
    }).sort((a, b) => b.change - a.change);

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      period: common,
      searchTrend: searchPoints.map((point) => Math.round(point.ratio)),
      searchPeriods: searchPoints.map((point) => point.period),
      shoppingTrend: shoppingPoints.map((point) => Math.round(point.ratio)),
      keywordChanges,
      gender: { female: genderShare.f || 0, male: genderShare.m || 0 },
      ages: ["10", "20", "30", "40", "50", "60"].map((group) => ({ label: group === "60" ? "60대+" : `${group}대`, value: ageIndex[group] || 0 })),
      source: "네이버 데이터랩 · 쇼핑인사이트",
      metricNotice: "검색량·클릭량과 연령 관심도는 비교 구간의 최댓값을 100으로 둔 상대지수입니다.",
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "데이터 조회에 실패했습니다." }, { status: 502 });
  }
}
