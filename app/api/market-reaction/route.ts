import { NextResponse } from "next/server";

type SearchItem = {
  title?: string;
  link?: string;
  description?: string;
  bloggername?: string;
  cafename?: string;
  postdate?: string;
};

type SearchResponse = {
  items?: SearchItem[];
  errorMessage?: string;
  message?: string;
};

type Credential = { id: string; secret: string };
type Source = "블로그" | "카페";
type Sentiment = "positive" | "negative" | "neutral";

type Mention = {
  title: string;
  description: string;
  text: string;
  link: string;
  source: Source;
  postdate: string | null;
  query: string;
};

const queries = [
  "캐릭터 냉장고",
  "라인프렌즈 냉장고",
  "브라운 캐릭터 냉장고",
  "꼬모 냉장고",
  "라인프렌즈 가전",
  "BT21 냉장고",
];

const positiveWords = [
  "예쁘", "귀엽", "갖고 싶", "갖고싶", "사고 싶", "사고싶", "탐나", "취향", "마음에",
  "매력", "소장", "기대", "좋아", "선물하고 싶", "감성", "취저", "대박",
];
const negativeWords = [
  "비싸", "부담", "필요 없", "필요없", "쓸모 없", "쓸모없", "자리 차지", "공간 부족",
  "소음 걱정", "전기료", "냉각 걱정", "성능 걱정", "아쉽", "과하", "별로", "애매",
];
const usedReviewWords = [
  "내돈내산", "사용 후기", "구매 후기", "실사용", "써봤", "사용해보", "한 달 사용", "한달 사용",
  "배송받", "직접 구매", "구입했", "샀는데", "설치했", "사용 중", "사용중", "후기", "사용 기간",
  "실제 사용", "숙소", "체감", "입양해왔", "입양(?)", "해왔", "데려왔", "받아왔", "진열상품", "고장",
];
const commercialWords = [
  "협찬", "제공받", "원고료", "광고 포함", "소정의", "체험단", "구매링크", "최저가", "렌탈 상담",
  "공동구매", "공구 진행", "스마트스토어", "제품 판매", "구매 문의", "전화 상담", "보도자료",
  "공식몰", "판매처", "출시 소식", "신제품 소개", "판매", "팝니다", "택배가능", "상품 정보",
  "시세조회", "중고", "거래 방법", "결제 혜택", "할부 수수료", "핫딜", "할인받고",
  "이벤트", "당첨", "드라마 출연", "드라마출연", "출연 기념", "잘 나가는", "전용 어댑터",
  "공식 sns", "공식sns",
];
const themes = [
  { name: "디자인·소장", words: ["예쁘", "귀엽", "디자인", "감성", "소장", "인테리어", "방꾸미기", "취향", "취저"] },
  { name: "구매 의향", words: ["갖고 싶", "갖고싶", "사고 싶", "사고싶", "탐나", "살까", "구매하고 싶"] },
  { name: "가격 부담", words: ["비싸", "가격", "부담", "가성비"] },
  { name: "공간·크기", words: ["자리", "공간", "크기", "작은", "방", "침실", "책상"] },
  { name: "성능 우려", words: ["소음", "냉각", "성능", "전기료", "온도"] },
  { name: "선물", words: ["선물", "생일", "집들이"] },
];
const reactionWords = [
  ...positiveWords,
  ...negativeWords,
  "살까", "구매", "가격", "디자인", "크기", "공간", "소음", "냉각", "성능", "전기료", "온도", "선물",
];

function credentials(): Credential[] {
  const candidates = [
    [process.env.NAVER_SEARCH_CLIENT_ID, process.env.NAVER_SEARCH_CLIENT_SECRET],
    [process.env.NAVER_TREND_CLIENT_ID, process.env.NAVER_TREND_CLIENT_SECRET],
    [process.env.NAVER_SHOPPING_CLIENT_ID, process.env.NAVER_SHOPPING_CLIENT_SECRET],
  ];

  const seen = new Set<string>();
  return candidates.flatMap(([id, secret]) => {
    if (!id || !secret || seen.has(id)) return [];
    seen.add(id);
    return [{ id, secret }];
  });
}

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

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function isRelevant(text: string, _query: string) {
  const compactText = text.replace(/\s+/g, "").toLowerCase();
  if (!compactText.includes("냉장고")) return false;

  const brandedFridge = ["꼬모", "라인프렌즈", "bt21"]
    .some((brand) => compactText.includes(brand));
  const genericCharacterFridge = compactText.includes("캐릭터냉장고");
  const namedCharacterFridge = /(브라운|샐리).{0,12}냉장고|냉장고.{0,12}(브라운|샐리)/.test(compactText);
  return brandedFridge || genericCharacterFridge || namedCharacterFridge;
}

function classify(text: string): Sentiment {
  const positive = positiveWords.filter((word) => text.includes(word)).length;
  const negative = negativeWords.filter((word) => text.includes(word)).length;
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}

async function searchNaver(source: "blog" | "cafearticle", query: string, available: Credential[]) {
  let lastError = "네이버 검색 API 호출에 실패했습니다.";
  for (const credential of available) {
    const params = new URLSearchParams({ query, display: "100", start: "1", sort: "date" });
    const response = await fetch(`https://openapi.naver.com/v1/search/${source}.json?${params}`, {
      headers: {
        "X-Naver-Client-Id": credential.id,
        "X-Naver-Client-Secret": credential.secret,
      },
      cache: "no-store",
    });
    const data = (await response.json()) as SearchResponse;
    if (response.ok) return data.items || [];
    lastError = data.errorMessage || data.message || `네이버 검색 API 오류 (${response.status})`;
    if (response.status !== 401 && response.status !== 403) break;
  }
  throw new Error(lastError);
}

export async function GET() {
  const available = credentials();
  if (!available.length) {
    return NextResponse.json({ error: "네이버 검색 API 연결 정보가 없습니다." }, { status: 503 });
  }

  try {
    const batches: { items: SearchItem[]; query: string; source: Source }[] = [];
    for (const query of queries) {
      const blogItems = await searchNaver("blog", query, available);
      batches.push({ items: blogItems, query, source: "블로그" });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const cafeItems = await searchNaver("cafearticle", query, available);
      batches.push({ items: cafeItems, query, source: "카페" });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const raw: Mention[] = batches.flatMap(({ items, query, source }) =>
      items.map((item) => {
        const title = clean(item.title);
        const description = clean(item.description);
        return {
          title,
          description,
          text: `${title} ${description}`.trim(),
          link: item.link || "",
          source,
          postdate: item.postdate || null,
          query,
        };
      }),
    );

    const unique = [...new Map(raw.filter((item) => item.link).map((item) => [item.link, item])).values()];
    const excluded = { commercial: 0, usedReview: 0, irrelevant: 0 };
    const eligible = unique.filter((item) => {
      if (!isRelevant(item.text, item.query)) {
        excluded.irrelevant += 1;
        return false;
      }
      if (!hasAny(item.text, reactionWords)) {
        excluded.irrelevant += 1;
        return false;
      }
      if (hasAny(item.text, commercialWords)) {
        excluded.commercial += 1;
        return false;
      }
      if (hasAny(item.text, usedReviewWords)) {
        excluded.usedReview += 1;
        return false;
      }
      return true;
    });

    const sentimentCounts = eligible.reduce(
      (counts, item) => {
        counts[classify(item.text)] += 1;
        return counts;
      },
      { positive: 0, negative: 0, neutral: 0 },
    );
    const denominator = Math.max(eligible.length, 1);
    const percentage = (value: number) => Math.round((value / denominator) * 100);

    const themeRows = themes
      .map((theme) => {
        const count = eligible.filter((item) => hasAny(item.text, theme.words)).length;
        return { name: theme.name, count, share: percentage(count) };
      })
      .filter((theme) => theme.count > 0)
      .sort((a, b) => b.count - a.count);

    const examples = eligible
      .map((item) => ({ ...item, sentiment: classify(item.text) }))
      .sort((a, b) => Number(Boolean(b.postdate)) - Number(Boolean(a.postdate)) || (b.postdate || "").localeCompare(a.postdate || ""))
      .slice(0, 8)
      .map((item) => ({
        title: item.title,
        excerpt: item.description.slice(0, 150),
        link: item.link,
        source: item.source,
        postdate: item.postdate,
        sentiment: item.sentiment,
      }));

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        scope: "네이버 최신순 공개 블로그·카페 검색결과",
        queries,
        counts: {
          collected: raw.length,
          unique: unique.length,
          analyzed: eligible.length,
          excluded: unique.length - eligible.length,
          ...excluded,
        },
        sources: {
          blog: eligible.filter((item) => item.source === "블로그").length,
          cafe: eligible.filter((item) => item.source === "카페").length,
        },
        sentiment: {
          positive: percentage(sentimentCounts.positive),
          negative: percentage(sentimentCounts.negative),
          neutral: percentage(sentimentCounts.neutral),
        },
        themes: themeRows,
        examples,
        reliable: eligible.length >= 30,
        warning: eligible.length >= 30 ? null : "광고·판매글·실사용 후기를 제외한 일반 반응이 30건 미만이라 탐색적 신호로만 해석해야 합니다.",
        methodology: "광고성 문구·실사용 후기를 제외하고, 제목과 검색 요약문에서 일반 소비자의 호감·우려·정보 탐색 표현을 규칙 기반으로 분류했습니다.",
        limitation: "공개 온라인 언급 표본이며 시장 전체 여론이나 작성자의 연령·성별을 대표하지 않습니다.",
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "온라인 반응을 수집하지 못했습니다." },
      { status: 502 },
    );
  }
}
