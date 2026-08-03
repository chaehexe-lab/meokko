#!/usr/bin/env python3
"""Inspect the SmartStore customer demographic chart without storing PII.

The script uses a dedicated Chrome profile so the seller logs in directly to
Naver.  It records only the customer-stats page URL, visible chart labels,
SVG geometry, and chart-bound aggregate values.  Cookies and credentials stay
inside the ignored local Chrome profile and are never written to the report.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROFILE_DIR = ROOT / "data" / "raw" / "smartstore_customer_stats" / "chrome-profile"
OUTPUT_PATH = ROOT / "data" / "raw" / "smartstore_customer_stats" / "chart-inspection.json"
NETWORK_OUTPUT_PATH = ROOT / "data" / "raw" / "smartstore_customer_stats" / "aggregate-network-responses.json"
CUSTOMER_RESPONSE_PATH = ROOT / "data" / "raw" / "smartstore_customer_stats" / "customer-stats-response.json"
DEMOGRAPHIC_RESPONSE_PATH = ROOT / "data" / "raw" / "smartstore_customer_stats" / "customer-demographics-response.json"
CRM_SNAPSHOT_PATH = ROOT / "api" / "dashboard" / "crm-snapshot.json"
CUSTOMER_STATS_URL = "https://sell.smartstore.naver.com/#/customer-stats/search"

AGE_BUCKETS = {
    "20대": ("early20s", "late20s"),
    "30대": ("early30s", "late30s"),
    "40대": ("early40s", "late40s"),
    "50대": ("early50s", "late50s"),
    "60대+": ("senior",),
}
ALL_AGE_KEYS = ("teenage",) + tuple(
    age_key for age_keys in AGE_BUCKETS.values() for age_key in age_keys
)


INSPECT_SCRIPT = r"""
const agePattern = /^(10대|20대\s*(초반|후반)?|30대\s*(초반|후반)?|40대\s*(초반|후반)?|50대\s*(초반|후반)?|60대\s*이상)$/;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const serializeDatum = value => {
  if (value == null) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(serializeDatum);
  if (typeof value !== 'object') return null;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (['string', 'number', 'boolean'].includes(typeof item) || item == null) result[key] = item;
  }
  return result;
};
const labels = [...document.querySelectorAll('text, span, div')]
  .map(element => clean(element.textContent))
  .filter(text => agePattern.test(text));
const svgs = [...document.querySelectorAll('svg')].map((svg, svgIndex) => ({
  svgIndex,
  width: svg.getAttribute('width'),
  height: svg.getAttribute('height'),
  viewBox: svg.getAttribute('viewBox'),
  text: [...svg.querySelectorAll('text')].map(node => clean(node.textContent)).filter(Boolean).slice(0, 100),
  marks: [...svg.querySelectorAll('rect, path')].slice(0, 300).map((node, markIndex) => ({
    markIndex,
    tag: node.tagName.toLowerCase(),
    x: node.getAttribute('x'),
    y: node.getAttribute('y'),
    width: node.getAttribute('width'),
    height: node.getAttribute('height'),
    d: node.tagName.toLowerCase() === 'path' ? node.getAttribute('d') : null,
    fill: node.getAttribute('fill') || getComputedStyle(node).fill,
    className: node.getAttribute('class'),
    datum: serializeDatum(node.__data__)
  }))
}));
const highcharts = (window.Highcharts?.charts || []).filter(Boolean).map((chart, chartIndex) => ({
  chartIndex,
  categories: chart.xAxis?.[0]?.categories || [],
  series: (chart.series || []).map(series => ({
    name: clean(series.name),
    color: series.color,
    visible: series.visible,
    data: (series.points || series.data || []).map(point => ({
      category: clean(point.category),
      name: clean(point.name),
      x: point.x,
      y: point.y
    }))
  }))
}));
return {
  title: document.title,
  url: location.href,
  ageLabels: [...new Set(labels)],
  svgs,
  highcharts
};
"""


def percentage(value, total):
    return round(value / total * 100) if total else 0


def build_period(rows, label):
    counts = {
        age_key: {"female": 0, "male": 0}
        for age_key in ALL_AGE_KEYS
    }
    for row in rows:
        for age_key in ALL_AGE_KEYS:
            for gender in ("female", "male"):
                counts[age_key][gender] += (
                    row[age_key]["newPurchaser"][gender]
                    + row[age_key]["rePurchaser"][gender]
                )

    female_count = sum(item["female"] for item in counts.values())
    male_count = sum(item["male"] for item in counts.values())
    total = female_count + male_count
    grouped_counts = {
        label: {
            gender: sum(counts[age_key][gender] for age_key in age_keys)
            for gender in ("female", "male")
        }
        for label, age_keys in AGE_BUCKETS.items()
    }
    target_age, target_gender = max(
        (
            (age_label, gender)
            for age_label in grouped_counts
            for gender in ("female", "male")
        ),
        key=lambda item: grouped_counts[item[0]][item[1]],
    )

    return {
        "label": label,
        "from": rows[0]["baseDate"][:7],
        "to": rows[-1]["baseDate"][:7],
        "target": f"{target_age} {'여성' if target_gender == 'female' else '남성'}",
        "targetBuyers": grouped_counts[target_age][target_gender],
        "totalBuyerCounts": total,
        "female": percentage(female_count, total),
        "male": percentage(male_count, total),
        "ages": [
            [age_label, percentage(values["female"] + values["male"], total)]
            for age_label, values in grouped_counts.items()
        ],
        "genderByAge": {
            age_label: {
                "female": percentage(values["female"], values["female"] + values["male"]),
                "male": percentage(values["male"], values["female"] + values["male"]),
                "femaleCount": values["female"],
                "maleCount": values["male"],
            }
            for age_label, values in grouped_counts.items()
        },
    }


def build_crm_snapshot(demographic_response):
    rows = sorted(demographic_response["contents"], key=lambda row: row["baseDate"])
    if len(rows) < 12:
        raise RuntimeError("최근 1년 고객현황이 필요합니다. 조회기간을 1년으로 설정하세요.")
    rows = rows[-12:]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "네이버 스마트스토어센터 데이터분석 > 고객현황 > 성별/연령별",
        "definition": "월별 신규구매고객과 재구매고객을 성별·연령별로 합산한 집계값이며 동일 고객이 여러 달에 걸쳐 중복 포함될 수 있음",
        "latestMonth": rows[-1]["baseDate"][:7],
        "periods": {
            "3m": build_period(rows[-3:], "최근 3개월"),
            "6m": build_period(rows[-6:], "최근 6개월"),
            "12m": build_period(rows, "최근 12개월"),
            "all": build_period(rows, "조회기간 전체"),
        },
    }


def main():
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as error:
        raise SystemExit("selenium이 필요합니다: python -m pip install selenium") from error

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    options = Options()
    options.add_argument(f"--user-data-dir={PROFILE_DIR}")
    options.add_argument("--start-maximized")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

    driver = webdriver.Chrome(options=options)
    try:
        driver.get(CUSTOMER_STATS_URL)
        print("로그인된 고객현황 그래프를 기다리고 있습니다.")
        deadline = time.time() + 180
        result = None
        while time.time() < deadline:
            result = driver.execute_script(INSPECT_SCRIPT)
            if result.get("ageLabels") and result.get("svgs"):
                break
            time.sleep(1)

        if not result or not result.get("ageLabels"):
            raise RuntimeError("성별/연령별 그래프를 찾지 못했습니다. 해당 탭과 조회 결과를 확인하세요.")

        payload = {
            "collectedAt": datetime.now(timezone.utc).isoformat(),
            "source": "네이버 스마트스토어센터 데이터분석 > 고객현황 > 성별/연령별",
            "containsPersonalInformation": False,
            "inspection": result,
        }
        OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"저장 완료: {OUTPUT_PATH}")

        candidates = []
        customer_stats_response = None
        demographic_response = None
        for entry in driver.get_log("performance"):
            try:
                message = json.loads(entry["message"])["message"]
                if message["method"] != "Network.responseReceived":
                    continue
                params = message["params"]
                response = params["response"]
                mime_type = response.get("mimeType", "").lower()
                if "json" not in mime_type:
                    continue
                response_url = response.get("url", "")
                if "/json/api/db/i18n/" in response_url:
                    continue
                is_customer_stats = (
                    "/api/v2/data-statistics/customers?" in response_url
                    and "/customers/grades?" not in response_url
                )
                if is_customer_stats:
                    body_result = driver.execute_cdp_cmd(
                        "Network.getResponseBody", {"requestId": params["requestId"]}
                    )
                    customer_stats_response = json.loads(body_result.get("body", "{}"))
                is_demographic_stats = "/api/v2/data-statistics/product-orders/statistics?" in response_url
                if is_demographic_stats:
                    body_result = driver.execute_cdp_cmd(
                        "Network.getResponseBody", {"requestId": params["requestId"]}
                    )
                    demographic_response = json.loads(body_result.get("body", "{}"))
                candidates.append({
                    "url": response_url,
                    "status": response.get("status"),
                    "mimeType": mime_type,
                })
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
            except Exception:
                # Some response bodies expire before CDP can read them.
                continue

        network_payload = {
            "collectedAt": datetime.now(timezone.utc).isoformat(),
            "source": "네이버 스마트스토어센터 고객현황 집계 응답",
            "containsPersonalInformation": False,
            "responses": candidates,
        }
        NETWORK_OUTPUT_PATH.write_text(
            json.dumps(network_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"집계 응답 저장 완료: {NETWORK_OUTPUT_PATH} ({len(candidates)}개)")
        if customer_stats_response is None:
            raise RuntimeError("고객현황 집계 API 응답을 찾지 못했습니다.")
        CUSTOMER_RESPONSE_PATH.write_text(
            json.dumps(customer_stats_response, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"고객통계 응답 저장 완료: {CUSTOMER_RESPONSE_PATH}")
        if demographic_response is None:
            raise RuntimeError("성별·연령 집계 API 응답을 찾지 못했습니다.")
        DEMOGRAPHIC_RESPONSE_PATH.write_text(
            json.dumps(demographic_response, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"성별·연령 응답 저장 완료: {DEMOGRAPHIC_RESPONSE_PATH}")
        crm_snapshot = build_crm_snapshot(demographic_response)
        CRM_SNAPSHOT_PATH.write_text(
            json.dumps(crm_snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"대시보드 CRM 스냅샷 저장 완료: {CRM_SNAPSHOT_PATH}")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
