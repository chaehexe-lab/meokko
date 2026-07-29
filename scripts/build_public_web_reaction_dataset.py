#!/usr/bin/env python3
import csv
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"


def read_csv(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, rows, fieldnames):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def normalize_sentiment(value):
    value = (value or "").strip()
    if value in {"긍정", "긍정/관심"}:
        return "긍정/관심"
    if value in {"부정", "부정/우려"}:
        return "부정/우려"
    if value in {"중립", "정보/중립"}:
        return "정보/중립"
    return "분류보류"


def main():
    now = datetime.now().isoformat(timespec="seconds")
    rows = []

    external = read_csv(PROCESSED / "external_ccomo_reaction_naver_cafe_results.csv")
    for row in external:
        sentiment = normalize_sentiment(row.get("sentiment"))
        rows.append({
            "collected_at": row.get("collected_at") or now,
            "source_group": row.get("channel_group") or "공개 웹",
            "source_file": "external_ccomo_reaction_naver_cafe_results.csv",
            "signal_type": "공개 검색 결과",
            "title": row.get("title", ""),
            "snippet": row.get("snippet", ""),
            "sentiment": sentiment,
            "keyword_group": row.get("keyword_groups", ""),
            "url": row.get("url", ""),
            "note": "네이버 공개 카페/블로그 검색 결과의 제목·요약·링크 기준",
        })

    review_mentions = read_csv(PROCESSED / "dashboard_review_voice_mentions.csv")
    for row in review_mentions:
        sentiment = normalize_sentiment(row.get("sentiment"))
        rows.append({
            "collected_at": now,
            "source_group": "쇼핑몰 리뷰",
            "source_file": "dashboard_review_voice_mentions.csv",
            "signal_type": "공식몰 리뷰 키워드",
            "title": row.get("product_name", ""),
            "snippet": row.get("evidence_snippet", ""),
            "sentiment": sentiment,
            "keyword_group": row.get("theme", ""),
            "url": "",
            "note": "공식몰 공개 리뷰에서 추출한 반응 키워드 단위",
        })

    smartstore_mentions = read_csv(PROCESSED / "smartstore_review_mentions.csv")
    for row in smartstore_mentions:
        sentiment = normalize_sentiment(row.get("sentiment"))
        rows.append({
            "collected_at": now,
            "source_group": "네이버 스마트스토어 리뷰",
            "source_file": "smartstore_review_mentions.csv",
            "signal_type": "스마트스토어 관리자 리뷰 키워드",
            "title": row.get("product_name", ""),
            "snippet": row.get("evidence_snippet", ""),
            "sentiment": sentiment,
            "keyword_group": row.get("theme", ""),
            "url": "",
            "note": "스마트스토어 리뷰 엑셀에서 개인정보성 항목을 제외한 뒤 추출한 반응 키워드 단위",
        })

    usable = [row for row in rows if row["sentiment"] != "분류보류"]
    total = len(usable) or 1
    sentiment_counts = Counter(row["sentiment"] for row in usable)
    keyword_counts = Counter()
    source_counts = Counter(row["source_group"] for row in rows)
    for row in usable:
        for group in [part.strip() for part in row["keyword_group"].split(",") if part.strip()]:
            keyword_counts[group] += 1

    summary = []
    for sentiment in ["긍정/관심", "정보/중립", "부정/우려"]:
        count = sentiment_counts.get(sentiment, 0)
        summary.append({
            "summary_type": "sentiment",
            "name": sentiment,
            "count": count,
            "percent": round(count / total * 100),
            "source": "public_web_reaction_signals.csv",
        })
    for name, count in keyword_counts.most_common():
        summary.append({
            "summary_type": "keyword_group",
            "name": name,
            "count": count,
            "percent": "",
            "source": "public_web_reaction_signals.csv",
        })
    for name, count in source_counts.most_common():
        summary.append({
            "summary_type": "source_group",
            "name": name,
            "count": count,
            "percent": "",
            "source": "public_web_reaction_signals.csv",
        })

    write_csv(
        PROCESSED / "public_web_reaction_signals.csv",
        rows,
        ["collected_at", "source_group", "source_file", "signal_type", "title", "snippet", "sentiment", "keyword_group", "url", "note"],
    )
    write_csv(
        PROCESSED / "public_web_reaction_summary.csv",
        summary,
        ["summary_type", "name", "count", "percent", "source"],
    )
    print(f"signals={len(rows)} usable={len(usable)}")
    print(dict(sentiment_counts))
    print(keyword_counts.most_common(10))
    print(dict(source_counts))


if __name__ == "__main__":
    main()
