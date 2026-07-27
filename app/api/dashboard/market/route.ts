import { NextResponse } from "next/server";
import { corsHeaders, corsOptions } from "../../../lib/cors";
import { credentials, lastCompleteDayRange, naverPost } from "../../../lib/naver-api";

type TrendPoint = { period: string; ratio: number; group?: string };
type TrendResponse = { results?: { title?: string; data?: TrendPoint[] }[] };

const CATEGORY = "50000003";
const KEYWORD = "소형 냉장고";
const AGE_GROUPS = ["10", "20", "30", "40", "50", "60"];

function sumGroups(points: TrendPoint[]) {
  return points.reduce<Record<string, number>>((totals, point) => {
    if (point.group) totals[point.group] = (totals[point.group] || 0) + Number(point.ratio || 0);
    return totals;
  }, {});
}

function toShares(totals: Record<string, number>) {
  const entries = Object.entries(totals);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return Object.fromEntries(entries.map(([key]) => [key, 0]));
  const raw = entries.map(([key, value]) => [key, (value / total) * 100] as const);
  const rounded = raw.map(([key, value]) => [key, Math.floor(value)] as [string, number]);
  let remainder = 100 - rounded.reduce((sum, [, value]) => sum + value, 0);
  const order = raw
    .map(([, value], index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < remainder; index += 1) rounded[order[index % order.length].index][1] += 1;
  return Object.fromEntries(rounded);
}

function topEntry(values: Record<string, number>, fallback: string) {
  return Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
}

export function OPTIONS(request: Request) {
  return corsOptions(request);
}

export async function GET(request: Request) {
  try {
    const credential = credentials("SHOPPING");
    const period = lastCompleteDayRange(1);
    const base = {
      ...period,
      category: CATEGORY,
      keyword: KEYWORD,
      device: "",
      gender: "",
      ages: [],
    };

    const ageResult = await naverPost<TrendResponse>(
      "/shopping/v1/category/keyword/age",
      "/v1/datalab/shopping/category/keyword/age",
      { ...base, ages: AGE_GROUPS },
      credential,
    );
    const ageShares = toShares(sumGroups(ageResult.data.results?.[0]?.data || []));
    const topAge = topEntry(ageShares, "20");

    const [genderResult, ...ageGenderResults] = await Promise.all([
      naverPost<TrendResponse>(
        "/shopping/v1/category/keyword/gender",
        "/v1/datalab/shopping/category/keyword/gender",
        base,
        credential,
      ),
      ...AGE_GROUPS.map((age) =>
        naverPost<TrendResponse>(
          "/shopping/v1/category/keyword/gender",
          "/v1/datalab/shopping/category/keyword/gender",
          { ...base, ages: [age] },
          credential,
        ),
      ),
    ]);

    const genderShares = toShares(sumGroups(genderResult.data.results?.[0]?.data || []));
    const genderByAge = Object.fromEntries(
      AGE_GROUPS.map((age, index) => {
        const shares = toShares(sumGroups(ageGenderResults[index].data.results?.[0]?.data || []));
        const female = shares.f || 0;
        const male = shares.m || 0;
        return [
          age === "60" ? "60대+" : `${age}대`,
          { female, male },
        ];
      }),
    );
    const targetGenderShares = genderByAge[topAge === "60" ? "60대+" : `${topAge}대`];
    const targetGender = targetGenderShares.female >= targetGenderShares.male ? "f" : "m";
    const target = `${topAge}대 ${targetGender === "f" ? "여성" : "남성"}`;

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        period,
        target,
        topAge,
        targetGender,
        targetGenderShares,
        gender: {
          female: genderShares.f || 0,
          male: genderShares.m || 0,
        },
        genderByAge,
        ages: AGE_GROUPS.map((group) => ({
          label: group === "60" ? "60대+" : `${group}대`,
          value: ageShares[group] || 0,
        })),
        source: `${ageResult.provider} 쇼핑 인사이트`,
        notice: "전날 하루의 상대 클릭지수를 합계 100%로 환산한 비중이며 매일 자정 갱신됩니다.",
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
      { error: error instanceof Error ? error.message : "잠재고객 데이터를 불러오지 못했습니다." },
      { status: 502, headers: corsHeaders(request) },
    );
  }
}
