"""Create privacy-safe STEP 1 negative-keyword signals from Cafe24 return CSV files.

Raw Cafe24 exports stay under data/raw and are never committed.  This script writes
only the fields needed for the dashboard, while redacting common PII patterns.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "cafe24_returns"
PROCESSED_DIR = ROOT / "data" / "processed"
PUBLIC_DASHBOARD_DATA = ROOT / "dashboard-prototype" / "data" / "cafe24-return-negative-keywords.json"

SIGNAL_FIELDS = [
    "collected_at",
    "return_request_date",
    "product_name",
    "product_code",
    "product_variant_code",
    "quantity",
    "return_status",
    "reason_type",
    "reason_detail",
    "keyword",
    "dashboard_eligible",
    "exclusion_reason",
    "source_file",
]

SUMMARY_FIELDS = [
    "keyword",
    "product_name",
    "return_status",
    "reason_type",
    "count",
    "example_reason_detail",
]

PII_PATTERNS = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[이메일 제거]"),
    (re.compile(r"(?<!\d)(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"), "[전화번호 제거]"),
    (re.compile(r"https?://\S+", re.IGNORECASE), "[URL 제거]"),
    (re.compile(r"(?<!\d)\d{8,}(?!\d)"), "[긴 숫자 제거]"),
]

KEYWORD_RULES = [
    ("설치 공간 부족", ("설치 공간", "공간이 부족", "자리", "들어가지 않", "놓을 곳")),
    ("생각보다 큼", ("생각보다 크", "너무 커", "사이즈가 크", "크기가 크")),
    ("생각보다 작음", ("생각보다 작", "너무 작", "사이즈가 작", "크기가 작")),
    ("소음", ("소음", "시끄", "소리가 커", "소리 너무")),
    ("냉각 불량", ("냉각", "냉장 안", "차갑지 않", "온도가 안")),
    ("파손", ("파손", "깨졌", "부서", "찌그러", "불량")),
    ("배송 문제", ("배송", "도착 지연", "늦게", "오배송")),
    ("상품 설명과 다름", ("설명과 다", "사진과 다", "상세페이지", "기대와 다")),
    ("가격 부담", ("비싸", "가격", "금액")),
    ("색상·디자인 불만", ("색상", "디자인", "색이")),
]

OPERATIONAL_REASON_TYPES = ("주문실수", "중복주문", "결제실수", "주소변경")
ACCESSORY_PATTERN = re.compile(r"어댑터|uv[- ]?c|가습기|필터", re.IGNORECASE)
CORE_PRODUCT_PATTERN = re.compile(r"꼬모냉장고", re.IGNORECASE)


def text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\ufeff", "")).strip()


def redact(value: str | None) -> str:
    result = text(value)
    for pattern, replacement in PII_PATTERNS:
        result = pattern.sub(replacement, result)
    return result[:500]


def read_csv(path: Path) -> list[dict[str, str]]:
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.DictReader(handle))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"CSV 인코딩을 읽을 수 없습니다: {path.name}")


def parse_reason(raw_reason: str | None) -> tuple[str, str]:
    raw = redact(raw_reason)
    match = re.match(r"^\[([^\]]+)\]\s*(.*)$", raw)
    if match:
        return text(match.group(1)), text(match.group(2))
    return "", raw


def return_status(row: dict[str, str]) -> str:
    if text(row.get("반품철회일")):
        return "반품철회"
    if text(row.get("반품접수거부 처리일")):
        return "반품접수거부"
    if text(row.get("반품처리중[환불완료] 처리일")):
        return "반품완료"
    if text(row.get("반품처리중[환불보류] 처리일")):
        return "환불보류"
    if text(row.get("반품처리중[수거완료] 처리일")):
        return "수거완료"
    if text(row.get("반품접수일")):
        return "반품접수"
    return "반품신청"


def classify_keyword(reason_type: str, reason_detail: str) -> str:
    if any(term in reason_type for term in OPERATIONAL_REASON_TYPES):
        return "주문 실수"
    normalized = f"{reason_type} {reason_detail}".lower()
    for label, patterns in KEYWORD_RULES:
        if any(pattern in normalized for pattern in patterns):
            return label
    return "기타 반품 사유"


def eligibility(product_name: str, status: str, keyword: str, reason_type: str) -> tuple[bool, str]:
    if status in {"반품철회", "반품접수거부"}:
        return False, f"{status} 건"
    if ACCESSORY_PATTERN.search(product_name):
        return False, "냉장고 본품이 아닌 상품"
    if not CORE_PRODUCT_PATTERN.search(product_name):
        return False, "STEP 1 대상 제품 아님"
    if keyword == "주문 실수" or any(term in reason_type for term in OPERATIONAL_REASON_TYPES):
        return False, "제품 불만이 아닌 주문 처리 사유"
    return True, ""


def row_to_signal(row: dict[str, str], source_file: str, collected_at: str) -> dict[str, str]:
    reason_type, reason_detail = parse_reason(row.get("반품신청 사유"))
    managed_name = redact(row.get("상품명(관리용)"))
    order_name = redact(row.get("주문상품명(옵션포함)"))
    # Some Cafe24 shops keep an internal SKU in "상품명(관리용)".  Prefer the
    # order-facing product name in that case so the dashboard stays readable.
    managed_name_is_code = bool(re.fullmatch(r"[A-Za-z0-9_-]{5,}", managed_name))
    product_name = order_name if managed_name_is_code and order_name else managed_name or order_name
    keyword = classify_keyword(reason_type, reason_detail)
    status = return_status(row)
    eligible, exclusion = eligibility(product_name, status, keyword, reason_type)
    return {
        "collected_at": collected_at,
        "return_request_date": text(row.get("반품신청일")),
        "product_name": product_name,
        "product_code": text(row.get("상품코드")),
        "product_variant_code": text(row.get("상품품목코드")),
        "quantity": text(row.get("수량")) or "1",
        "return_status": status,
        "reason_type": reason_type or text(row.get("반품신청 구분")) or "미분류",
        "reason_detail": reason_detail,
        "keyword": keyword,
        "dashboard_eligible": "Y" if eligible else "N",
        "exclusion_reason": exclusion,
        "source_file": source_file,
    }


def stable_source_key(row: dict[str, str]) -> str:
    parts = [
        text(row.get("품목별 주문번호")),
        text(row.get("상품품목코드")),
        text(row.get("반품신청일")),
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def archive_source_file(path: Path) -> Path:
    """Keep a local copy so daily updates are aggregated without uploading raw CSVs."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    resolved = path.resolve()
    if resolved.parent == RAW_DIR.resolve():
        return resolved
    fingerprint = hashlib.sha256(resolved.read_bytes()).hexdigest()[:12]
    archived = RAW_DIR / f"{resolved.stem}_{fingerprint}{resolved.suffix.lower()}"
    if not archived.exists():
        shutil.copy2(resolved, archived)
    return archived


def build_summary(signals: list[dict[str, str]]) -> list[dict[str, str]]:
    grouped: OrderedDict[tuple[str, str, str, str], dict[str, str]] = OrderedDict()
    for signal in signals:
        if signal["dashboard_eligible"] != "Y":
            continue
        key = tuple(signal[field] for field in ("keyword", "product_name", "return_status", "reason_type"))
        item = grouped.get(key)
        if item is None:
            grouped[key] = {
                "keyword": signal["keyword"],
                "product_name": signal["product_name"],
                "return_status": signal["return_status"],
                "reason_type": signal["reason_type"],
                "count": "1",
                "example_reason_detail": signal["reason_detail"],
            }
        else:
            item["count"] = str(int(item["count"]) + 1)
    return list(grouped.values())


def process(files: list[Path]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    collected_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    signals: list[dict[str, str]] = []
    seen: set[str] = set()
    for path in files:
        for row in read_csv(path):
            fingerprint = stable_source_key(row)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            signals.append(row_to_signal(row, path.name, collected_at))
    return signals, build_summary(signals)


def main() -> None:
    parser = argparse.ArgumentParser(description="Cafe24 반품 CSV를 STEP 1 반품 키워드 데이터로 변환합니다.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", type=Path, help="처리할 Cafe24 CSV 파일")
    source.add_argument("--dir", type=Path, help="처리할 Cafe24 CSV가 들어 있는 폴더")
    args = parser.parse_args()

    if args.file:
        archive_source_file(args.file)
        files = sorted(RAW_DIR.glob("*.csv"))
    else:
        files = sorted(args.dir.glob("*.csv"))
    files = [path for path in files if path.is_file()]
    if not files:
        raise SystemExit("처리할 CSV 파일이 없습니다.")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    signals, summary = process(files)
    write_csv(PROCESSED_DIR / "cafe24_return_signals.csv", SIGNAL_FIELDS, signals)
    write_csv(PROCESSED_DIR / "cafe24_return_keyword_summary.csv", SUMMARY_FIELDS, summary)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source_file_count": len(files),
        "signal_count": len(signals),
        "dashboard_keyword_count": len(summary),
        "negative_keywords": summary,
    }
    (PROCESSED_DIR / "cafe24_return_negative_keywords.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # This public file contains only the aggregated, PII-redacted dashboard fields.
    # The raw export and row-level processed files remain under ignored data/ folders.
    PUBLIC_DASHBOARD_DATA.parent.mkdir(parents=True, exist_ok=True)
    public_payload = {
        "generated_at": payload["generated_at"],
        "dashboard_keyword_count": len(summary),
        "negative_keywords": summary,
    }
    PUBLIC_DASHBOARD_DATA.write_text(
        json.dumps(public_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"처리 완료: 반품 신호 {len(signals)}건 / 대시보드 부정 키워드 {len(summary)}건")
    print(f"출력 폴더: {PROCESSED_DIR}")


if __name__ == "__main__":
    main()
