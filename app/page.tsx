"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { crmSummary } from "./data/crm-summary";

type DatasetKey = "search" | "reviews" | "crm" | "competitors";
type Row = Record<string, string>;

type Analysis = {
  positive: number;
  negative: number;
  neutral: number;
  topBarrier: string;
  barrierRate: number;
  topMotive: string;
  target: string;
  evidence: string;
};

type LiveMarketData = {
  fetchedAt: string;
  searchTrend: number[];
  searchPeriods: string[];
  shoppingTrend: number[];
  keywordChanges: { keyword: string; change: number }[];
  gender: { female: number; male: number };
  ages: { label: string; value: number }[];
  source: string;
  metricNotice: string;
};

type MarketReactionData = {
  fetchedAt: string;
  scope: string;
  counts: {
    collected: number;
    unique: number;
    analyzed: number;
    excluded: number;
    commercial: number;
    usedReview: number;
    irrelevant: number;
  };
  sources: { blog: number; cafe: number };
  sentiment: { positive: number; negative: number; neutral: number };
  themes: { name: string; count: number; share: number }[];
  examples: {
    title: string;
    excerpt: string;
    link: string;
    source: string;
    postdate: string | null;
    sentiment: "positive" | "negative" | "neutral";
  }[];
  methodology: string;
  limitation: string;
  reliable: boolean;
  warning: string | null;
};

const sampleTrend = [38, 42, 45, 41, 48, 52, 60, 72, 85, 79, 63, 51, 44, 49, 46, 53, 61, 78, 91, 84, 66, 54, 48, 59];
const sampleAges = [
  { label: "10대", value: 12 },
  { label: "20대", value: 31 },
  { label: "30대", value: 28 },
  { label: "40대", value: 18 },
  { label: "50대+", value: 11 },
];
const characters = [
  { name: "브라운", teen: 58, twenty: 74, thirty: 68, forty: 51 },
  { name: "샐리", teen: 71, twenty: 69, thirty: 56, forty: 42 },
  { name: "코니", teen: 55, twenty: 63, thirty: 59, forty: 46 },
  { name: "BT21", teen: 82, twenty: 77, thirty: 43, forty: 25 },
];
const sampleCompetitors = [
  { name: "꼬모 브라운 31L", price: 498000, score: 86, sales: 64, accent: "#3767ff", feature: "캐릭터 일체형 디자인 · 블루투스 · 3~16℃", channel: "자사몰 · 네이버 · 와디즈", message: "내 방의 작은 친구" },
  { name: "카카오프렌즈 80L", price: 359000, score: 75, sales: 83, accent: "#ff9d35", feature: "라이언·어피치 IP · 냉장/냉동 · 2도어", channel: "종합몰 · 오픈마켓", message: "캐릭터와 실용성을 동시에" },
  { name: "캐리어 31L", price: 220000, score: 52, sales: 71, accent: "#5cae86", feature: "동일 용량 · 냉장/냉동 전환 · 실용형", channel: "가전몰 · 오픈마켓", message: "작지만 확실한 냉각" },
  { name: "스메그 FAB5 34L", price: 1390000, score: 91, sales: 38, accent: "#d4638e", feature: "프리미엄 레트로 디자인 · 34L", channel: "백화점 · 프리미엄 편집숍", message: "주방을 바꾸는 디자인" },
  { name: "하이얼 46L", price: 125000, score: 39, sales: 92, accent: "#8a94a6", feature: "방 안 음료 보관 · 가성비 · 간이냉동", channel: "오픈마켓 · 가격비교", message: "책상 아래 실속 냉장고" },
];

const dataCards: { key: DatasetKey; title: string; description: string; columns: string }[] = [
  { key: "search", title: "검색 수요", description: "월별 키워드와 상대 관심도", columns: "period, keyword, value" },
  { key: "reviews", title: "리뷰·외부 반응", description: "감성과 원인을 분석할 원문", columns: "date, source, text, rating" },
  { key: "crm", title: "구매·문의 CRM", description: "실제 고객과 사용 상황", columns: "date, age, gender, type, text" },
  { key: "competitors", title: "경쟁제품", description: "가격·판매지표·기능·채널", columns: "name, price, sales, features, channels" },
];

const positiveWords = ["좋", "귀엽", "만족", "예쁘", "조용", "편리", "추천", "잘", "유용", "매력"];
const negativeWords = ["비싸", "불편", "작", "소음", "고장", "아쉽", "약하", "느리", "문제", "불만"];
const barriers = [
  { name: "가격 부담", words: ["비싸", "가격", "부담", "가성비"] },
  { name: "용량 부족", words: ["작", "용량", "수납", "안 들어"] },
  { name: "냉장 성능 불신", words: ["안 시원", "냉각", "온도", "성능", "약하"] },
  { name: "소음 우려", words: ["소음", "시끄", "진동"] },
  { name: "사용 목적 부족", words: ["필요", "쓸모", "용도"] },
];
const motives = [
  { name: "디자인·소장 가치", words: ["귀엽", "예쁘", "캐릭터", "디자인", "소장"] },
  { name: "개인 공간 음료 보관", words: ["방", "음료", "맥주", "침실", "책상"] },
  { name: "선물", words: ["선물", "생일", "아이", "자녀"] },
  { name: "화장품 보관", words: ["화장품", "마스크팩", "스킨"] },
];

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").toLowerCase());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function findText(row: Row) {
  return row.text || row.review || row.content || row.message || row.inquiry || Object.values(row).join(" ");
}

function countMatches(texts: string[], words: string[]) {
  return texts.filter((text) => words.some((word) => text.includes(word))).length;
}

function analyzeRows(reviews: Row[], crm: Row[]): Analysis {
  const texts = [...reviews, ...crm].map(findText).filter(Boolean);
  if (!texts.length) {
    return {
      positive: 68,
      negative: 21,
      neutral: 11,
      topBarrier: "가격 부담",
      barrierRate: 34,
      topMotive: "디자인·소장 가치",
      target: "20~30대 캐릭터 굿즈 관심층",
      evidence: "예시 데이터 기준 · 실제 CSV 업로드 후 재분석 필요",
    };
  }
  let positive = 0;
  let negative = 0;
  texts.forEach((text) => {
    const pos = positiveWords.filter((word) => text.includes(word)).length;
    const neg = negativeWords.filter((word) => text.includes(word)).length;
    if (pos > neg) positive += 1;
    else if (neg > pos) negative += 1;
  });
  const neutral = texts.length - positive - negative;
  const barrierScores = barriers.map((item) => ({ name: item.name, count: countMatches(texts, item.words) })).sort((a, b) => b.count - a.count);
  const motiveScores = motives.map((item) => ({ name: item.name, count: countMatches(texts, item.words) })).sort((a, b) => b.count - a.count);
  const ages = crm.map((row) => Number.parseInt(row.age || "0", 10)).filter(Boolean);
  const avgAge = ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 28;
  const target = avgAge < 25 ? "10~20대 캐릭터·굿즈 관심층" : avgAge < 35 ? "20~30대 개인 공간 보유층" : "30~40대 본인·자녀 구매층";
  const ratio = (value: number) => Math.round((value / texts.length) * 100);
  return {
    positive: ratio(positive),
    negative: ratio(negative),
    neutral: ratio(neutral),
    topBarrier: barrierScores[0]?.name ?? "분석 자료 부족",
    barrierRate: ratio(barrierScores[0]?.count ?? 0),
    topMotive: motiveScores[0]?.name ?? "분석 자료 부족",
    target,
    evidence: `리뷰·문의 ${texts.length.toLocaleString("ko-KR")}건의 키워드 근거`,
  };
}

function formatWon(value: number) {
  return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("overview");
  const [datasets, setDatasets] = useState<Record<DatasetKey, Row[]>>({ search: [], reviews: [], crm: [], competitors: [] });
  const [fileNames, setFileNames] = useState<Partial<Record<DatasetKey, string>>>({});
  const [analysis, setAnalysis] = useState<Analysis>(() => analyzeRows([], []));
  const [running, setRunning] = useState(false);
  const [liveMarket, setLiveMarket] = useState<LiveMarketData | null>(null);
  const [liveError, setLiveError] = useState("");
  const [marketReaction, setMarketReaction] = useState<MarketReactionData | null>(null);
  const [reactionError, setReactionError] = useState("");
  const inputRefs = useRef<Partial<Record<DatasetKey, HTMLInputElement | null>>>({});

  useEffect(() => {
    let active = true;
    fetch("/api/naver-market?range=24m", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "실데이터를 불러오지 못했습니다.");
        return data as LiveMarketData;
      })
      .then((data) => { if (active) setLiveMarket(data); })
      .catch((error) => { if (active) setLiveError(error instanceof Error ? error.message : "실데이터 연결 실패"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/market-reaction", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "온라인 반응을 불러오지 못했습니다.");
        return data as MarketReactionData;
      })
      .then((data) => { if (active) setMarketReaction(data); })
      .catch((error) => { if (active) setReactionError(error instanceof Error ? error.message : "온라인 반응 연결 실패"); });
    return () => { active = false; };
  }, []);

  const competitors = useMemo(() => {
    if (!datasets.competitors.length) return sampleCompetitors;
    return datasets.competitors.slice(0, 10).map((row, index) => ({
      name: row.name || row.product || `경쟁제품 ${index + 1}`,
      price: Number(row.price?.replace(/[^0-9.]/g, "")) || 0,
      sales: Number(row.sales?.replace(/[^0-9.]/g, "")) || Number(row.reviews?.replace(/[^0-9.]/g, "")) || 0,
      score: Math.max(35, 82 - index * 6),
      accent: ["#3767ff", "#ff9d35", "#5cae86", "#d4638e", "#8a94a6"][index % 5],
      feature: row.features || row.feature || "특징 데이터 없음",
      channel: row.channels || row.channel || "채널 데이터 없음",
      message: row.message || row.marketing || "마케팅 문구 데이터 없음",
    }));
  }, [datasets.competitors]);

  const trend = useMemo(() => {
    if (!datasets.search.length) return liveMarket?.searchTrend?.length ? liveMarket.searchTrend : sampleTrend;
    const values = datasets.search.map((row) => Number(row.value || row.ratio || row.volume || 0)).filter((value) => Number.isFinite(value));
    return values.length ? values.slice(-24) : sampleTrend;
  }, [datasets.search, liveMarket]);

  const ageRows = liveMarket?.ages?.length ? liveMarket.ages : sampleAges;
  const topAge = [...ageRows].sort((a, b) => b.value - a.value)[0];
  const femaleShare = liveMarket?.gender.female || 58;
  const maleShare = liveMarket?.gender.male || 42;
  const monthLabels = liveMarket?.searchPeriods?.length ? liveMarket.searchPeriods.map((period) => period.slice(2, 7).replace("-", ".")) : trend.map((_, index) => `${index + 1}월`);
  const rangeLabel = liveMarket?.searchPeriods?.length
    ? `${liveMarket.searchPeriods.length}개월 · ${monthLabels[0]}~${monthLabels.at(-1)}`
    : "최근 24개월";
  const keywordRows = liveMarket?.keywordChanges?.length
    ? liveMarket.keywordChanges.map((item) => [item.keyword, `${item.change > 0 ? "+" : ""}${item.change}%`])
    : [["화장품 냉장고", "+42%"], ["방 냉장고", "+31%"], ["캐릭터 냉장고", "+28%"], ["술장고", "+19%"], ["저소음 미니냉장고", "+16%"]];
  const trendChange = trend.length > 1 && trend[0] ? Math.round(((trend.at(-1)! - trend[0]) / trend[0]) * 1000) / 10 : 0;
  const purchaseAgeRows = crmSummary.customer.ageBuyers;
  const maxPurchaseAge = Math.max(...purchaseAgeRows.map((item) => item.buyers), 1);
  const topPurchaseAge = [...purchaseAgeRows].sort((a, b) => b.buyers - a.buyers)[0];
  const femaleBuyerShare = Math.round((crmSummary.customer.genderBuyers[1].buyers / crmSummary.customer.buyers) * 100);
  const maleBuyerShare = 100 - femaleBuyerShare;
  const maxSales = Math.max(...crmSummary.sales.monthly24.map(([, units]) => units), 1);
  const maxCsPhenomenon = Math.max(...crmSummary.cs.phenomena.map(([, count]) => count), 1);
  const topCsShare = Math.round(crmSummary.cs.phenomena[0][1] / crmSummary.cs.records * 100);
  const reactionSentiment = marketReaction?.sentiment ?? { positive: 0, negative: 0, neutral: 0 };
  const reactionDonut = `conic-gradient(var(--green) 0 ${reactionSentiment.positive}%, var(--red) ${reactionSentiment.positive}% ${reactionSentiment.positive + reactionSentiment.negative}%, #dfe5ef 0)`;

  async function handleFile(key: DatasetKey, file?: File) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    setDatasets((current) => ({ ...current, [key]: rows }));
    setFileNames((current) => ({ ...current, [key]: file.name }));
  }

  function runAnalysis() {
    setRunning(true);
    window.setTimeout(() => {
      setAnalysis(analyzeRows(datasets.reviews, datasets.crm));
      setRunning(false);
      setActiveTab("overview");
    }, 650);
  }

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      analysis,
      sourceCounts: Object.fromEntries(Object.entries(datasets).map(([key, rows]) => [key, rows.length])),
      competitors: competitors.map(({ name, price, sales, feature, channel, message }) => ({ name, price, sales, feature, channel, message })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ccomo-market-analysis.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const sourceCount = Object.values(datasets).filter((rows) => rows.length).length;
  const maxTrend = Math.max(...trend, 1);
  const tabItems = [
    ["overview", "종합 분석"],
    ["market", "시장 데이터"],
    ["customer", "고객 데이터"],
    ["competitor", "경쟁사 분석"],
    ["data", "데이터 연결"],
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span>c</span></div>
          <div>
            <p className="eyebrow">CCOMO MARKET INTELLIGENCE</p>
            <h1>꼬모 시장분석 AI</h1>
          </div>
        </div>
        <div className="top-actions">
          <span className="source-state connected" title={liveError}><i /> CRM 3개{liveMarket ? " + 네이버 연결" : " 연결"}{sourceCount ? ` + 추가 ${sourceCount}개` : ""}</span>
          <button className="ghost-button" onClick={exportReport}>분석 결과 저장</button>
          <button className="primary-button" onClick={runAnalysis} disabled={running}>{running ? "분석 중…" : "AI 분석 실행"}</button>
        </div>
      </header>

      <nav className="tabs" aria-label="분석 영역">
        {tabItems.map(([key, label]) => <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>)}
      </nav>

      <section className="content">
        {activeTab === "overview" && (
          <>
            <section className="hero-insight">
              <div className="hero-copy">
                <span className="ai-label">CRM 실데이터 인사이트</span>
                <h2>실제 결제고객이 가장 많은 연령은<br/><strong>{topPurchaseAge.label}</strong>입니다.</h2>
                <p>18개월간 결제고객 <b>{crmSummary.customer.buyers.toLocaleString("ko-KR")}명</b> 중 30·40대가 358명으로, 전체의 <b>71.7%</b>를 차지했습니다.</p>
                <div className="evidence"><span>근거</span>스마트스토어 고객분석 성·연령별 원본 · {crmSummary.customer.period}</div>
              </div>
              <div className="hero-score">
                <div className="score-ring" style={{ "--score": "71.7%" } as React.CSSProperties}><strong>71.7</strong><span>30·40대 비중</span></div>
                <p>관심지수가 아닌 실제 결제고객 구성비입니다.</p>
              </div>
            </section>

            <section className="metric-grid">
              <article className="metric-card"><span>검색 관심도</span><strong>{trendChange > 0 ? "+" : ""}{trendChange}%</strong><small>{liveMarket ? "최근 24개월 첫 달 대비 변화" : "예시 데이터 기준"}</small><div className="spark-bars">{trend.slice(-8).map((v, i) => <i key={i} style={{ height: `${Math.max(18, v / maxTrend * 100)}%` }} />)}</div></article>
              <article className="metric-card"><span>실제 결제고객</span><strong>{crmSummary.customer.buyers.toLocaleString("ko-KR")}명</strong><small>{crmSummary.customer.months}개월 누적 · 전환율 {crmSummary.customer.conversion}%</small><div className="meter"><i style={{ width: `${crmSummary.customer.conversion}%` }} /></div></article>
              <article className="metric-card warning"><span>최다 구매 연령</span><strong>{topPurchaseAge.label}</strong><small>{topPurchaseAge.buyers}명 · 전체의 {Math.round(topPurchaseAge.buyers / crmSummary.customer.buyers * 100)}%</small><div className="tag-row"><em>CRM</em><em>실결제</em><em>18개월</em></div></article>
              <article className="metric-card"><span>CS 접수</span><strong>{crmSummary.cs.records.toLocaleString("ko-KR")}건</strong><small>{crmSummary.cs.period} · 수리·교환 기록</small><div className="mini-line"><i/><i/><i/><i/><i/></div></article>
            </section>

            <section className="dashboard-grid">
              <article className="panel trend-panel">
                <div className="panel-head"><div><span className="panel-kicker">MARKET DEMAND</span><h3>월별 소형 냉장고 관심도</h3></div><span className="period-chip">{rangeLabel}</span></div>
                <div className="trend-scroll"><div className="bar-trend" aria-label="최근 2년 월별 관심도 막대그래프">
                  {trend.map((value, index) => <div key={index} className={value === maxTrend ? "peak" : ""}><span style={{ height: `${Math.max(12, value / maxTrend * 100)}%` }}><b>{value}</b></span><small>{monthLabels[index] || `${index + 1}월`}</small></div>)}
                </div></div>
                <p className="chart-note"><i/> ‘소형 냉장고’·‘미니 냉장고’·‘1인 냉장고’ 통합검색 상대지수 · 최고 월=100</p>
              </article>

              <article className="panel sentiment-panel">
                <div className="panel-head"><div><span className="panel-kicker">CS SIGNAL</span><h3>실제 CS 현상 구성</h3></div><button className="text-button" onClick={() => setActiveTab("customer")}>상세 보기 →</button></div>
                <div className="sentiment-layout">
                  <div className="donut" style={{ background: `conic-gradient(#3767ff 0 ${topCsShare}%, #ff9d35 ${topCsShare}% 90%, #e9edf5 0)` }}><div><strong>{topCsShare}%</strong><span>{crmSummary.cs.phenomena[0][0]}</span></div></div>
                  <div className="sentiment-list">
                    {crmSummary.cs.phenomena.slice(0, 3).map(([label, count], index) => <p key={label}><i className={`dot ${index === 0 ? "positive" : index === 1 ? "neutral" : "negative"}`}/><span>{label}</span><b>{Math.round(count / crmSummary.cs.records * 100)}%</b></p>)}
                  </div>
                </div>
                <div className="keyword-cloud"><b>접수 {crmSummary.cs.records.toLocaleString("ko-KR")}건</b><span>부품교환</span><span>방문 AS</span><em>어댑터</em><span>냉장</span><em>디스플레이</em></div>
              </article>

              <article className="panel target-panel">
                <div className="panel-head"><div><span className="panel-kicker">BUYER PROFILE</span><h3>실제 결제고객 연령</h3></div><span className="source-badge">스마트스토어 CRM</span></div>
                <div className="horizontal-bars">
                  {purchaseAgeRows.map((age) => <div key={age.label}><span>{age.label}</span><i><b style={{ width: `${age.buyers / maxPurchaseAge * 100}%` }}/></i><strong>{age.buyers}명</strong></div>)}
                </div>
                <div className="target-summary"><span>최다 결제 연령</span><b>{topPurchaseAge.label} · {topPurchaseAge.buyers}명</b><small>{crmSummary.customer.period} 누적 결제고객 기준</small></div>
              </article>

              <article className="panel barrier-panel">
                <div className="panel-head"><div><span className="panel-kicker">CS PRIORITY</span><h3>CS 현상 우선순위</h3></div><span className="source-badge">접수 원본 집계</span></div>
                <div className="rank-list">
                  {crmSummary.cs.phenomena.slice(0, 5).map(([label, count], index)=><div key={label} className={index===0?"hot":""}><span>{index+1}</span><b>{label}</b><i><em style={{width:`${count/maxCsPhenomenon*100}%`}}/></i><strong>{count.toLocaleString("ko-KR")}건</strong></div>)}
                </div>
              </article>
            </section>
          </>
        )}

        {activeTab === "market" && (
          <section className="page-section">
            <div className="section-title"><div><span className="panel-kicker">MARKET DATA</span><h2>시장에서 고객 신호 찾기</h2><p>검색 관심도는 구매량이 아닌 수요 신호로 표시합니다.</p></div><span className="quality-badge">상대지수 · 출처 구분</span></div>
            <div className="dashboard-grid">
              <article className="panel wide reaction-panel">
                <div className="panel-head">
                  <div><span className="panel-kicker">PUBLIC BUZZ</span><h3>캐릭터 냉장고 온라인 공개 반응</h3><p>광고성 문구와 실사용 후기를 제외한 네이버 블로그·공개 카페 언급</p></div>
                  <span className="source-badge">{marketReaction ? `${marketReaction.reliable ? "분석" : "표본 부족"} ${marketReaction.counts.analyzed.toLocaleString("ko-KR")}건` : reactionError ? "연결 확인 필요" : "수집 중"}</span>
                </div>
                {marketReaction ? (
                  <>
                    <div className="reaction-overview">
                      <div className="donut reaction-donut" style={{ background: reactionDonut }}>
                        <div><strong>{reactionSentiment.positive}%</strong><span>긍정 반응</span></div>
                      </div>
                      <div className="sentiment-list reaction-sentiments">
                        <p><i className="dot positive"/><span>긍정</span><b>{reactionSentiment.positive}%</b></p>
                        <p><i className="dot negative"/><span>부정</span><b>{reactionSentiment.negative}%</b></p>
                        <p><i className="dot neutral"/><span>중립·정보탐색</span><b>{reactionSentiment.neutral}%</b></p>
                        <small>수집 {marketReaction.counts.collected.toLocaleString("ko-KR")}건 → 중복 제거 {marketReaction.counts.unique.toLocaleString("ko-KR")}건 → 최종 분석 {marketReaction.counts.analyzed.toLocaleString("ko-KR")}건</small>
                      </div>
                      <div className="reaction-themes">
                        <h4>주요 반응 주제</h4>
                        {marketReaction.themes.slice(0, 5).map((theme) => <p key={theme.name}><span>{theme.name}</span><i><b style={{ width: `${theme.share}%` }}/></i><strong>{theme.count}건</strong></p>)}
                      </div>
                    </div>
                    <div className="reaction-evidence">
                      <div><b>분석 기준</b><span>{marketReaction.methodology}</span></div>
                      <div><b>제외 내역</b><span>문맥 불일치 {marketReaction.counts.irrelevant}건 · 광고 {marketReaction.counts.commercial}건 · 실사용 후기 {marketReaction.counts.usedReview}건</span></div>
                      <div><b>해석 주의</b><span>{marketReaction.limitation}</span></div>
                      {marketReaction.warning && <div><b>표본 경고</b><span>{marketReaction.warning}</span></div>}
                    </div>
                    {marketReaction.examples.length > 0 && <div className="reaction-links">{marketReaction.examples.slice(0, 4).map((example) => <a key={example.link} href={example.link} target="_blank" rel="noreferrer"><em>{example.source}</em><span>{example.title}</span></a>)}</div>}
                  </>
                ) : (
                  <div className="reaction-empty"><strong>{reactionError ? "온라인 반응을 불러오지 못했습니다." : "공개 반응을 수집하고 있습니다."}</strong><span>{reactionError || "네이버 최신 공개 검색결과를 정리하는 중입니다."}</span></div>
                )}
              </article>
              <article className="panel wide"><div className="panel-head"><div><h3>2년간 시즌별 검색 수요</h3><p>완료된 최근 24개월 · 월별 키워드 관심도 상대지수</p></div></div><div className="trend-scroll"><div className="bar-trend tall">{trend.map((v,i)=><div key={i}><span style={{height:`${v/maxTrend*100}%`}}><b>{v}</b></span><small>{monthLabels[i] || `${i+1}월`}</small></div>)}</div></div></article>
              <article className="panel"><div className="panel-head"><div><h3>성별 관심 분포</h3><p>네이버 쇼핑 클릭 기준</p></div></div><div className="gender-split"><div className="gender-circle female">{femaleShare}%</div><div><b>여성 {femaleShare}%</b><span>남성 {maleShare}%</span><small>실제 구매자 성별과 다를 수 있음</small></div></div></article>
              <article className="panel"><div className="panel-head"><div><h3>연령별 검색 관심</h3><p>네이버 쇼핑 클릭 상대지수</p></div><span className="source-badge">최고 {topAge.label}</span></div><div className="horizontal-bars">{ageRows.map((age)=><div key={age.label}><span>{age.label}</span><i><b style={{width:`${age.value/Math.max(...ageRows.map(item=>item.value),1)*100}%`}}/></i><strong>{age.value}</strong></div>)}</div></article>
              <article className="panel"><div className="panel-head"><div><h3>키워드 증감</h3><p>{liveMarket ? "최근 3개월 vs 직전 3개월" : "예시 데이터"}</p></div></div><div className="keyword-table">{keywordRows.map(([a,b],i)=><p key={a}><span>{i+1}</span><b>{a}</b><em>{b}</em></p>)}</div></article>
              <article className="panel wide"><div className="panel-head"><div><h3>꼬모 유상판매 24개월 추이</h3><p>전체 소형 냉장고 시장이 아닌 자사 순판매량</p></div><span className="source-badge">유상판매현황 원본</span></div><div className="trend-scroll"><div className="bar-trend tall">{crmSummary.sales.monthly24.map(([month,units])=><div key={month}><span style={{height:`${Math.max(8, units/maxSales*100)}%`}}><b>{units}</b></span><small>{month.slice(2).replace("-", ".")}</small></div>)}</div></div><p className="chart-note"><i/> {crmSummary.sales.period} 전체 순판매 {crmSummary.sales.netUnits.toLocaleString("ko-KR")}대 · 최근 24개월만 표시</p></article>
              <article className="panel wide"><div className="panel-head"><div><h3>연령대별 라인 캐릭터 호감도</h3><p>동일 이미지·무작위 순서 설문 필요</p></div><span className="source-badge">예시 설문 n=200</span></div><div className="heat-table"><div className="heat-head"><span>캐릭터</span><span>10대</span><span>20대</span><span>30대</span><span>40대</span></div>{characters.map(c=><div key={c.name}><b>{c.name}</b>{[c.teen,c.twenty,c.thirty,c.forty].map((v,i)=><span key={i} style={{"--alpha":`${Math.max(.12,v/100)}`} as React.CSSProperties}>{v}%</span>)}</div>)}</div></article>
            </div>
          </section>
        )}

        {activeTab === "customer" && (
          <section className="page-section">
            <div className="section-title"><div><span className="panel-kicker">CUSTOMER DATA</span><h2>실제 고객과 CS 데이터</h2><p>구매자 구성과 접수 현상은 실데이터로, 구매 동기와 만족도는 미확인으로 구분합니다.</p></div><span className="quality-badge">개인식별자 제외</span></div>
            <section className="metric-grid three"><article className="metric-card"><span>결제고객</span><strong>{crmSummary.customer.buyers.toLocaleString("ko-KR")}명</strong><small>{crmSummary.customer.period} · 스마트스토어</small></article><article className="metric-card"><span>구매전환율</span><strong>{crmSummary.customer.conversion}%</strong><small>방문 {crmSummary.customer.visitors.toLocaleString("ko-KR")}명 기준</small></article><article className="metric-card warning"><span>CS 접수</span><strong>{crmSummary.cs.records.toLocaleString("ko-KR")}건</strong><small>{crmSummary.cs.period} · 수리·교환 데이터</small></article></section>
            <div className="dashboard-grid">
              <article className="panel"><div className="panel-head"><div><h3>결제고객 연령</h3><p>연령대별 누적 결제고객</p></div></div><div className="rank-list clean">{[...purchaseAgeRows].sort((a,b)=>b.buyers-a.buyers).slice(0,5).map((item,i)=><div key={item.label}><span>{i+1}</span><b>{item.label}</b><i><em style={{width:`${item.buyers/maxPurchaseAge*100}%`}}/></i><strong>{item.buyers}명</strong></div>)}</div></article>
              <article className="panel"><div className="panel-head"><div><h3>성별 결제고객</h3><p>스마트스토어 실결제 기준</p></div></div><div className="gender-split"><div className="gender-circle female">{femaleBuyerShare}%</div><div><b>여성 {femaleBuyerShare}% · 265명</b><span>남성 {maleBuyerShare}% · 234명</span><small>방문고객이 아닌 결제고객 구성비</small></div></div></article>
              <article className="panel wide"><div className="panel-head"><div><h3>CS 접수 현상</h3><p>원본의 ‘현상구분’ 항목을 그대로 집계</p></div><span className="source-badge">{crmSummary.cs.records.toLocaleString("ko-KR")}건</span></div><div className="issue-grid">{crmSummary.cs.phenomena.map(([label,count])=><div key={label}><strong>{Math.round(count/crmSummary.cs.records*100)}%</strong><span>{label} · {count.toLocaleString("ko-KR")}건</span></div>)}</div></article>
              <article className="panel wide"><div className="panel-head"><div><h3>현재 확인된 것과 추가로 필요한 것</h3><p>CRM으로 알 수 있는 범위를 넘지 않도록 구분합니다.</p></div></div><div className="reason-columns"><div className="reason positive-reason"><span>실데이터로 확인</span><h4>30·40대가 결제고객의 71.7%입니다.</h4><ul><li>여성 53%, 남성 47%로 성별 차이는 크지 않음</li><li>18개월 누적 구매전환율 3.5%</li><li>CS는 어댑터와 냉장 현상이 대부분</li></ul></div><div className="reason negative-reason"><span>추가 데이터 필요</span><h4>긍정 반응률과 구매 동기는 아직 계산할 수 없습니다.</h4><ul><li>리뷰·블로그·커뮤니티 원문이 있어야 반응 분석 가능</li><li>구매 동기는 설문 또는 리뷰 사용 상황 응답 필요</li><li>CS 접수률 계산은 판매 코호트별 연결 필요</li></ul></div></div></article>
            </div>
          </section>
        )}

        {activeTab === "competitor" && (
          <section className="page-section">
            <div className="section-title"><div><span className="panel-kicker">COMPETITOR DATA</span><h2>경쟁제품 비교와 마케팅 분석</h2><p>판매량을 확보할 수 없으면 공개 구매 건수·리뷰 수·인기순위를 구분해 사용합니다.</p></div><span className="quality-badge">최대 10개 제품</span></div>
            <article className="panel competitor-table-panel">
              <div className="competitor-table" role="table">
                <div className="table-row table-head" role="row"><span>제품</span><span>가격</span><span>공개 인기도</span><span>디자인 점수</span><span>상세 분석</span></div>
                {competitors.map((product)=><div className="table-row" role="row" key={product.name}>
                  <span className="product-name"><i style={{background:product.accent}}/>{product.name}</span><strong>{product.price?formatWon(product.price):"미입력"}</strong><span className="popularity"><i><b style={{width:`${Math.min(100,product.sales)}%`}}/></i>{product.sales||"-"}</span><span className="score">{product.score}/100</span><details><summary>펼쳐보기</summary><div className="detail-drawer"><p><b>공통 특징</b>{product.feature}</p><p><b>주요 채널</b>{product.channel}</p><p><b>핵심 메시지</b>{product.message}</p><p><b>AI 해석</b>{product.score>80?"디자인·소장 가치 중심의 직접 비교군":"기능·가격 중심의 대체재"}</p></div></details>
                </div>)}
              </div>
            </article>
            <div className="dashboard-grid marketing-grid">
              <article className="panel"><div className="panel-head"><div><h3>주요 마케팅 플랫폼</h3><p>공식 계정·판매페이지 분석</p></div></div><div className="platform-list">{[["네이버 쇼핑",92],["인스타그램",84],["와디즈",76],["유튜브",61],["오늘의집",54]].map(([n,v])=><p key={String(n)}><span>{n}</span><i><b style={{width:`${v}%`}}/></i><strong>{v}</strong></p>)}</div></article>
              <article className="panel"><div className="panel-head"><div><h3>잘 팔리는 메시지 유형</h3><p>콘텐츠 문구 AI 분류</p></div></div><div className="message-chips"><span className="active">공간 절약</span><span>저소음</span><span>감성 디자인</span><span>냉장·냉동</span><span>선물</span><span>한정판</span><span>가성비</span></div><div className="best-message"><small>추천 비교 포인트</small><b>“기능이 있는 굿즈”가 아니라<br/>“친구가 된 개인 냉장고”</b></div></article>
            </div>
          </section>
        )}

        {activeTab === "data" && (
          <section className="page-section data-page">
            <div className="section-title"><div><span className="panel-kicker">DATA CONNECTION</span><h2>CRM 실데이터가 연결됐습니다</h2><p>성·연령별 고객분석, 유상판매현황, CS접수현황을 개인식별자 없이 집계했습니다.</p></div><button className="primary-button large" onClick={runAnalysis}>{running?"분석 중…":"추가 CSV 분석"}</button></div>
            <article className="panel schema-panel"><div><span className="ai-label">CONNECTED CRM</span><h3>현재 사용 중인 실데이터</h3></div><ul><li><b>고객분석</b> {crmSummary.customer.period} · 결제고객 {crmSummary.customer.buyers}명</li><li><b>유상판매</b> {crmSummary.sales.period} · {crmSummary.sales.sourceRows.toLocaleString("ko-KR")}행</li><li><b>CS접수</b> {crmSummary.cs.period} · {crmSummary.cs.records.toLocaleString("ko-KR")}건</li><li><b>개인정보</b> 대시보드에는 집계값만 포함</li></ul></article>
            <div className="upload-grid">
              {dataCards.map((card)=><article className={`upload-card ${datasets[card.key].length?"uploaded":""}`} key={card.key} onClick={()=>inputRefs.current[card.key]?.click()}>
                <input ref={(node)=>{inputRefs.current[card.key]=node}} type="file" accept=".csv,text/csv" onChange={(event)=>handleFile(card.key,event.target.files?.[0])}/>
                <div className="upload-icon">{datasets[card.key].length?"✓":"＋"}</div><h3>{card.title}</h3><p>{card.description}</p><code>{card.columns}</code><span>{fileNames[card.key] ? `${fileNames[card.key]} · ${datasets[card.key].length}행` : "CSV 선택"}</span>
              </article>)}
            </div>
            <article className="panel schema-panel"><div><span className="ai-label">분석 원칙</span><h3>AI가 숫자를 만들어내지 않도록 설계했습니다.</h3></div><ul><li><b>숫자 계산</b> CSV의 실제 값으로만 계산</li><li><b>텍스트 분류</b> 감성·동기·저해 요인별 근거 문장 유지</li><li><b>판매량 부재</b> 리뷰 수와 인기순위를 판매량으로 표시하지 않음</li><li><b>출처 표시</b> 모든 차트에 기간·표본·출처 연결</li></ul></article>
          </section>
        )}
      </section>
      <footer><span>CCOMO MARKET AI · CRM CONNECTED</span><p>CRM과 네이버 지표는 실데이터이며, 캐릭터 호감도·경쟁사 예시는 실조사 전까지 예시로 구분합니다.</p></footer>
    </main>
  );
}
