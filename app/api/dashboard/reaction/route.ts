import { NextResponse } from "next/server";
import { credentials, naverSearch } from "../../../lib/naver-api";

type SearchItem = {
  title?: string;
  link?: string;
  description?: string;
  postdate?: string;
};

type SearchResponse = {
  items?: SearchItem[];
};

type Sentiment = "positive" | "neutral" | "negative";

const QUERIES = ["꼬모 냉장고", "꼬모냉장고 후기", "꼬모 냉장고 사용"];
const POSITIVE_WORDS = ["좋", "만족", "예쁘", "귀엽", "추천", "편리", "활용", "조용", "유용", "매력", "깔끔"];
const NEGATIVE_WORDS = ["비싸", "불편", "소음", "고장", "아쉽", "작다", "작아", "부족", "문제", "불만", "약하"];
const COMMERCIAL_WORDS = [
  "광고",
  "협찬",
  "체험단",
  "공동구매",
  "판매합니다",
  "구매링크",
  "최저가",
  "할인코드",
  "구매 문의",
  "공식몰",
];
const THEMES = [
  { label: "디자인", words: ["예쁘", "귀엽", "디자인", "감성", "인테리어"] },
  { label: "활용성", words: ["활용", "음료", "화장품", "보관", "방", "사무실"] },
  { label: "가격", words: ["가격", "비싸", "가성비"] },
  { label: "소음", words: ["소음", "조용", "시끄"] },
  { label: "용량", words: ["용량", "수납", "작다", "작아", "부족"] },
];

function clean(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(text: string): Sentiment {
  const positive = POSITIVE_WORDS.filter((word) => text.includes(word)).length;
  const negative = NEGATIVE_WORDS.filter((word) => text.includes(word)).length;
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}

function topThemes(items: { text: string }[]) {
  return THEMES.map((theme) => ({
    label: theme.label,
    count: items.filter((item) => theme.words.some((word) => item.text.includes(word))).length,
  }))
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count);
}

export async function GET() {
  try {
    const credential = credentials("SEARCH");
    const batches = await Promise.all(
      QUERIES.flatMap((query) =>
        (["blog", "cafearticle"] as const).map(async (source) => {
          const params = new URLSearchParams({
            query,
            display: "100",
            start: "1",
            sort: "date",
            format: "json",
          });
          const response = await naverSearch<SearchResponse>(source, params, credential);
          return {
            query,
            source: source === "blog" ? "블로그" : "카페",
            provider: response.provider,
            items: response.data.items || [],
          };
        }),
      ),
    );

    const collected = batches.flatMap((batch) =>
      batch.items.map((item) => {
        const title = clean(item.title);
        const description = clean(item.description);
        return {
          title,
          description,
          text: `${title} ${description}`,
          link: item.link || "",
          postdate: item.postdate || null,
          source: batch.source,
          query: batch.query,
        };
      }),
    );
    const unique = [...new Map(collected.filter((item) => item.link).map((item) => [item.link, item])).values()];
    const eligible = unique.filter((item) => {
      const compact = item.text.replace(/\s+/g, "");
      if (!compact.includes("냉장고") || !compact.includes("꼬모")) return false;
      return !COMMERCIAL_WORDS.some((word) => item.text.includes(word));
    });
    const classified = eligible.map((item) => ({ ...item, sentiment: classify(item.text) }));
    const counts = {
      positive: classified.filter((item) => item.sentiment === "positive").length,
      neutral: classified.filter((item) => item.sentiment === "neutral").length,
      negative: classified.filter((item) => item.sentiment === "negative").length,
    };
    const denominator = Math.max(classified.length, 1);
    const percentage = (value: number) => Math.round((value / denominator) * 100);
    const sentiments = Object.fromEntries(
      (["positive", "neutral", "negative"] as const).map((sentiment) => {
        const items = classified.filter((item) => item.sentiment === sentiment);
        return [
          sentiment,
          {
            percent: percentage(counts[sentiment]),
            themes: topThemes(items).slice(0, 4),
            example:
              items
                .sort((a, b) => (b.postdate || "").localeCompare(a.postdate || ""))
                .slice(0, 1)
                .map((item) => ({
                  title: item.title,
                  excerpt: item.description.slice(0, 160),
                  link: item.link,
                  source: item.source,
                  postdate: item.postdate,
                }))[0] || null,
          },
        ];
      }),
    );

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        counts: {
          collected: collected.length,
          unique: unique.length,
          analyzed: classified.length,
          excluded: unique.length - classified.length,
        },
        sentiments,
        source: `${batches[0]?.provider || "NAVER API HUB"} 블로그·공개 카페 검색`,
        notice: "검색 API가 제공하는 제목·요약에서 광고성 문구를 제외한 규칙 기반 분석입니다.",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "반응 데이터를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
