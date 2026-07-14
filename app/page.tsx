"use client";

import { useMemo, useRef, useState } from "react";

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

const sampleTrend = [42, 49, 46, 53, 61, 78, 91, 84, 66, 54, 48, 59];
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
  const inputRefs = useRef<Partial<Record<DatasetKey, HTMLInputElement | null>>>({});

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
    if (!datasets.search.length) return sampleTrend;
    const values = datasets.search.map((row) => Number(row.value || row.ratio || row.volume || 0)).filter((value) => Number.isFinite(value));
    return values.length ? values.slice(-12) : sampleTrend;
  }, [datasets.search]);

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
          <span className={`source-state ${sourceCount ? "connected" : ""}`}><i /> {sourceCount ? `${sourceCount}개 데이터 연결` : "예시 데이터 모드"}</span>
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
                <span className="ai-label">AI 종합 인사이트</span>
                <h2>현재 가장 가능성 높은 고객은<br/><strong>{analysis.target}</strong>입니다.</h2>
                <p>핵심 구매 동기는 <b>{analysis.topMotive}</b>, 가장 큰 저해 요인은 <b>{analysis.topBarrier}</b>로 나타났습니다.</p>
                <div className="evidence"><span>근거</span>{analysis.evidence}</div>
              </div>
              <div className="hero-score">
                <div className="score-ring" style={{ "--score": "72%" } as React.CSSProperties}><strong>72</strong><span>시장 기회 점수</span></div>
                <p>관심도는 높지만 가격 가치 증명이 필요합니다.</p>
              </div>
            </section>

            <section className="metric-grid">
              <article className="metric-card"><span>검색 관심도</span><strong>+28.5%</strong><small>최근 3개월 대비</small><div className="spark-bars">{trend.slice(-8).map((v, i) => <i key={i} style={{ height: `${Math.max(18, v / maxTrend * 100)}%` }} />)}</div></article>
              <article className="metric-card"><span>긍정 반응률</span><strong>{analysis.positive}%</strong><small>리뷰·문의 텍스트 기준</small><div className="meter"><i style={{ width: `${analysis.positive}%` }} /></div></article>
              <article className="metric-card warning"><span>최대 구매 저해 요인</span><strong>{analysis.topBarrier}</strong><small>관련 언급 {analysis.barrierRate}%</small><div className="tag-row"><em>가격</em><em>가성비</em><em>비교</em></div></article>
              <article className="metric-card"><span>경쟁제품 가격 중앙값</span><strong>{formatWon([...competitors].sort((a,b) => a.price-b.price)[Math.floor(competitors.length/2)]?.price || 0)}</strong><small>공개 판매가 기준</small><div className="mini-line"><i/><i/><i/><i/><i/></div></article>
            </section>

            <section className="dashboard-grid">
              <article className="panel trend-panel">
                <div className="panel-head"><div><span className="panel-kicker">MARKET DEMAND</span><h3>월별 소형 냉장고 관심도</h3></div><span className="period-chip">최근 12개월</span></div>
                <div className="bar-trend" aria-label="월별 관심도 막대그래프">
                  {trend.map((value, index) => <div key={index} className={index === 6 || index === 7 ? "peak" : ""}><span style={{ height: `${Math.max(12, value / maxTrend * 100)}%` }}><b>{value}</b></span><small>{index + 1}월</small></div>)}
                </div>
                <p className="chart-note"><i/> 7~8월 수요 집중 · ‘미니 냉장고’, ‘화장품 냉장고’, ‘술장고’ 동반 상승</p>
              </article>

              <article className="panel sentiment-panel">
                <div className="panel-head"><div><span className="panel-kicker">MARKET REACTION</span><h3>꼬모 반응 분석</h3></div><button className="text-button" onClick={() => setActiveTab("customer")}>원인 보기 →</button></div>
                <div className="sentiment-layout">
                  <div className="donut" style={{ background: `conic-gradient(#3767ff 0 ${analysis.positive}%, #ff6f61 ${analysis.positive}% ${analysis.positive + analysis.negative}%, #e9edf5 0)` }}><div><strong>{analysis.positive}%</strong><span>긍정</span></div></div>
                  <div className="sentiment-list">
                    <p><i className="dot positive"/><span>긍정</span><b>{analysis.positive}%</b></p>
                    <p><i className="dot neutral"/><span>중립</span><b>{analysis.neutral}%</b></p>
                    <p><i className="dot negative"/><span>부정</span><b>{analysis.negative}%</b></p>
                  </div>
                </div>
                <div className="keyword-cloud"><b>귀여운 디자인</b><span>소장 가치</span><span>저소음</span><em>가격 부담</em><span>선물용</span><em>용량</em></div>
              </article>

              <article className="panel target-panel">
                <div className="panel-head"><div><span className="panel-kicker">TARGET SIGNAL</span><h3>관심층 연령 분포</h3></div><span className="source-badge">네이버 쇼핑 클릭</span></div>
                <div className="horizontal-bars">
                  {sampleAges.map((age) => <div key={age.label}><span>{age.label}</span><i><b style={{ width: `${age.value / 35 * 100}%` }}/></i><strong>{age.value}%</strong></div>)}
                </div>
                <div className="target-summary"><span>핵심 구간</span><b>20~39세 59%</b><small>실제 구매자는 CRM 데이터로 별도 검증</small></div>
              </article>

              <article className="panel barrier-panel">
                <div className="panel-head"><div><span className="panel-kicker">PURCHASE BARRIER</span><h3>구매 저해 요인</h3></div><span className="source-badge">AI 분류</span></div>
                <div className="rank-list">
                  {[{n:"가격 부담",v:34},{n:"냉장 성능 불신",v:24},{n:"용량 부족",v:18},{n:"소음 우려",v:13},{n:"사용 목적 부족",v:11}].map((item,index)=><div key={item.n} className={index===0?"hot":""}><span>{index+1}</span><b>{item.n}</b><i><em style={{width:`${item.v/34*100}%`}}/></i><strong>{item.v}%</strong></div>)}
                </div>
              </article>
            </section>
          </>
        )}

        {activeTab === "market" && (
          <section className="page-section">
            <div className="section-title"><div><span className="panel-kicker">MARKET DATA</span><h2>시장에서 고객 신호 찾기</h2><p>검색 관심도는 구매량이 아닌 수요 신호로 표시합니다.</p></div><span className="quality-badge">상대지수 · 출처 구분</span></div>
            <div className="dashboard-grid">
              <article className="panel wide"><div className="panel-head"><div><h3>시즌별 검색 수요</h3><p>월별 키워드 관심도 상대지수</p></div></div><div className="bar-trend tall">{trend.map((v,i)=><div key={i}><span style={{height:`${v/maxTrend*100}%`}}><b>{v}</b></span><small>{i+1}월</small></div>)}</div></article>
              <article className="panel"><div className="panel-head"><div><h3>성별 관심 분포</h3><p>네이버 쇼핑 클릭 기준</p></div></div><div className="gender-split"><div className="gender-circle female">58%</div><div><b>여성 58%</b><span>남성 42%</span><small>실제 구매자 성별과 다를 수 있음</small></div></div></article>
              <article className="panel"><div className="panel-head"><div><h3>상승 키워드</h3><p>최근 3개월 증감</p></div></div><div className="keyword-table">{[["화장품 냉장고","+42%"],["방 냉장고","+31%"],["캐릭터 냉장고","+28%"],["술장고","+19%"],["저소음 미니냉장고","+16%"]].map(([a,b],i)=><p key={a}><span>{i+1}</span><b>{a}</b><em>{b}</em></p>)}</div></article>
              <article className="panel wide"><div className="panel-head"><div><h3>연령대별 라인 캐릭터 호감도</h3><p>동일 이미지·무작위 순서 설문 필요</p></div><span className="source-badge">예시 설문 n=200</span></div><div className="heat-table"><div className="heat-head"><span>캐릭터</span><span>10대</span><span>20대</span><span>30대</span><span>40대</span></div>{characters.map(c=><div key={c.name}><b>{c.name}</b>{[c.teen,c.twenty,c.thirty,c.forty].map((v,i)=><span key={i} style={{"--alpha":`${Math.max(.12,v/100)}`} as React.CSSProperties}>{v}%</span>)}</div>)}</div></article>
            </div>
          </section>
        )}

        {activeTab === "customer" && (
          <section className="page-section">
            <div className="section-title"><div><span className="panel-kicker">CUSTOMER DATA</span><h2>사용한 사람들의 목소리</h2><p>리뷰와 문의를 구매 동기·불편·개선 기회로 구조화합니다.</p></div><span className="quality-badge">근거 원문 보존</span></div>
            <section className="metric-grid three"><article className="metric-card"><span>분석 문장</span><strong>{(datasets.reviews.length+datasets.crm.length||326).toLocaleString()}건</strong><small>리뷰와 문의 합계</small></article><article className="metric-card"><span>주요 구매 동기</span><strong>{analysis.topMotive}</strong><small>관련 키워드 묶음</small></article><article className="metric-card warning"><span>개선 우선순위</span><strong>{analysis.topBarrier}</strong><small>빈도 × 부정 강도</small></article></section>
            <div className="dashboard-grid">
              <article className="panel"><div className="panel-head"><div><h3>구매 동기</h3><p>실제 사용 상황 분류</p></div></div><div className="rank-list clean">{[["디자인·소장 가치",38],["개인 공간 음료 보관",26],["선물",18],["화장품 보관",11],["자녀 간식 보관",7]].map(([n,v],i)=><div key={String(n)}><span>{i+1}</span><b>{n}</b><i><em style={{width:`${Number(v)/38*100}%`}}/></i><strong>{v}%</strong></div>)}</div></article>
              <article className="panel"><div className="panel-head"><div><h3>문의 유형</h3><p>개선 기회 탐색</p></div></div><div className="issue-grid">{[["온도·냉각",29],["배송·설치",21],["블루투스",17],["소음",14],["AS",11],["사용법",8]].map(([n,v])=><div key={String(n)}><strong>{v}%</strong><span>{n}</span></div>)}</div></article>
              <article className="panel wide"><div className="panel-head"><div><h3>반응 원인 총정리</h3><p>감성만 보여주지 않고 판단 근거를 함께 제공합니다.</p></div></div><div className="reason-columns"><div className="reason positive-reason"><span>긍정 원인</span><h4>“냉장고라기보다 방 안의 캐릭터 오브제 같아요.”</h4><ul><li>형태 자체가 캐릭터인 독특한 디자인</li><li>침실에 두기 좋은 크기와 저소음</li><li>선물·굿즈로서의 소장 가치</li></ul></div><div className="reason negative-reason"><span>부정 원인</span><h4>“기능이 좋아도 일반 31L 제품보다 가격이 부담돼요.”</h4><ul><li>동일 용량 실용형 제품 대비 높은 가격</li><li>냉동 불가와 실제 냉각 성능에 대한 질문</li><li>스피커 기능을 얼마나 쓸지 불확실</li></ul></div></div></article>
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
            <div className="section-title"><div><span className="panel-kicker">DATA CONNECTION</span><h2>분석할 데이터를 연결하세요</h2><p>CSV는 이 브라우저 안에서만 처리되며, 텍스트 원문과 출처가 함께 보존됩니다.</p></div><button className="primary-button large" onClick={runAnalysis}>{running?"분석 중…":"업로드 데이터 분석"}</button></div>
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
      <footer><span>CCOMO MARKET AI · MVP 0.1</span><p>예시 수치는 화면 설계 검증용입니다. 실제 의사결정에는 출처가 확인된 데이터를 사용하세요.</p></footer>
    </main>
  );
}
