#!/usr/bin/env python3
"""
Download Naver Smartstore review Excel files and convert them into
privacy-safe review signals for the STEP1 reaction dashboard.

Stored fields intentionally exclude buyer name, ID, phone, address, order id,
and any other direct customer identifiers.
"""

import argparse
import csv
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "smartstore_reviews"
PROCESSED = ROOT / "data" / "processed"
DOWNLOAD_DIR = RAW_DIR / "downloads"
REVIEW_URL = "https://sell.smartstore.naver.com/#/review/search"

SAFE_FIELDS = [
    "collected_at",
    "review_date",
    "product_name",
    "option_name",
    "rating",
    "review_text",
    "photo_review",
    "seller_reply",
    "source_file",
]

MENTION_FIELDS = [
    "product_name",
    "evidence_snippet",
    "sentiment",
    "theme",
    "review_date",
    "rating",
    "source_file",
]

COLUMN_PATTERNS = {
    "review_date": [r"작성.*일", r"등록.*일", r"리뷰.*일", r"구매평.*일", r"날짜"],
    "product_name": [r"상품명", r"상품"],
    "option_name": [r"옵션", r"옵션명"],
    "rating": [r"평점", r"별점", r"만족도"],
    "review_text": [r"리뷰.*내용", r"리뷰", r"구매평", r"상품평", r"내용"],
    "photo_review": [r"사진", r"포토", r"이미지"],
    "seller_reply": [r"판매자.*답", r"답변", r"댓글", r"답글"],
}

DROP_HINTS = [
    "구매자",
    "고객명",
    "주문자",
    "수취인",
    "아이디",
    "id",
    "전화",
    "휴대",
    "연락처",
    "주소",
    "주문번호",
    "주문.*id",
    "결제번호",
    "배송지",
    "우편",
]

THEME_PATTERNS = [
    ("디자인/귀여움", r"귀엽|예쁘|이쁘|디자인|캐릭터|브라운|샐리|라인프렌즈|감성|인테리어"),
    ("선물/소장", r"선물|소장|생일|기념|굿즈"),
    ("홈바/간식/음료", r"홈바|술|맥주|와인|음료|간식|캔|주류"),
    ("사무실/개인공간", r"사무실|회사|책상|방|침실|자취|원룸|개인"),
    ("화장품 보관", r"화장품|스킨케어|마스크팩|뷰티"),
    ("사용 편의", r"편하|활용|만족|잘.?사용|좋아|추천|실용"),
    ("배송/응대 만족", r"배송.*빠르|빠른.*배송|친절|응대"),
    ("가격 부담", r"비싸|가격|금액|부담|고가"),
    ("소음 걱정", r"소음|시끄|소리|무소음"),
    ("용량/수납 아쉬움", r"용량|수납|작다|작아|크기|공간|좁"),
    ("냉각/냉동 아쉬움", r"냉각|냉동|시원|온도|차갑|안.?시원"),
    ("고장/수리/AS", r"고장|수리|AS|A/S|전원|어댑터|불량"),
    ("배송/반품", r"반품|교환|파손|배송.*문제|늦"),
]

NEGATIVE_THEMES = {
    "가격 부담",
    "소음 걱정",
    "용량/수납 아쉬움",
    "냉각/냉동 아쉬움",
    "고장/수리/AS",
    "배송/반품",
}

EXCLUDED_PRODUCT_PATTERNS = [
    r"어댑터",
    r"UV-?C\s*살균키트",
]


def ensure_dirs():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)


def normalize_text(value):
    if value is None:
        return ""
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def find_column(columns, patterns):
    for pattern in patterns:
        regex = re.compile(pattern, re.I)
        for column in columns:
            if regex.search(str(column)):
                return column
    return None


def is_private_column(column):
    column = str(column)
    return any(re.search(pattern, column, re.I) for pattern in DROP_HINTS)


def is_excluded_product(product_name):
    return any(re.search(pattern, product_name, re.I) for pattern in EXCLUDED_PRODUCT_PATTERNS)


def read_review_file(path):
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if suffix == ".csv":
        try:
            return pd.read_csv(path, encoding="utf-8-sig")
        except UnicodeDecodeError:
            return pd.read_csv(path, encoding="cp949")
    raise ValueError(f"지원하지 않는 파일 형식입니다: {path}")


def sanitize_reviews(input_path):
    df = read_review_file(input_path)
    columns = list(df.columns)
    mapping = {field: find_column(columns, patterns) for field, patterns in COLUMN_PATTERNS.items()}

    rows = []
    now = datetime.now().isoformat(timespec="seconds")
    for _, row in df.iterrows():
        safe = {
            "collected_at": now,
            "source_file": input_path.name,
        }
        for field in SAFE_FIELDS:
            if field in {"collected_at", "source_file"}:
                continue
            source_column = mapping.get(field)
            if source_column and not is_private_column(source_column):
                value = normalize_text(row.get(source_column))
                if field == "photo_review":
                    safe[field] = "있음" if value else "없음"
                else:
                    safe[field] = value
            else:
                safe[field] = ""
        if safe["review_text"] or safe["rating"] or safe["product_name"]:
            if is_excluded_product(safe.get("product_name", "")):
                continue
            rows.append(safe)
    return rows


def infer_rating(value):
    text = normalize_text(value)
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def extract_themes(text):
    themes = []
    for label, pattern in THEME_PATTERNS:
        if re.search(pattern, text, re.I):
            themes.append(label)
    return themes or ["정보 탐색"]


def infer_sentiment(rating, themes, text):
    has_negative_theme = any(theme in NEGATIVE_THEMES for theme in themes)
    has_positive_word = bool(re.search(r"좋|만족|추천|예쁘|이쁘|귀엽|편하|빠르", text))
    if rating is not None:
      if rating <= 2:
          return "부정/우려"
      if rating >= 4 and not has_negative_theme:
          return "긍정/관심"
    if has_negative_theme and not has_positive_word:
        return "부정/우려"
    if has_positive_word:
        return "긍정/관심"
    return "정보/중립"


def build_mentions(safe_rows):
    mentions = []
    for row in safe_rows:
        text = normalize_text(row.get("review_text"))
        if not text:
            continue
        rating = infer_rating(row.get("rating"))
        themes = extract_themes(text)
        sentiment = infer_sentiment(rating, themes, text)
        snippet = text[:180]
        for theme in themes:
            mentions.append({
                "product_name": row.get("product_name", ""),
                "evidence_snippet": snippet,
                "sentiment": sentiment,
                "theme": theme,
                "review_date": row.get("review_date", ""),
                "rating": row.get("rating", ""),
                "source_file": row.get("source_file", ""),
            })
    return mentions


def write_csv(path, rows, fieldnames):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def latest_download(before):
    candidates = [
        path for path in DOWNLOAD_DIR.iterdir()
        if path.is_file()
        and path.suffix.lower() in {".xlsx", ".xls", ".csv"}
        and path.stat().st_mtime >= before
        and not path.name.endswith(".crdownload")
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def wait_for_download(start_time, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        downloaded = latest_download(start_time)
        if downloaded:
            return downloaded
        time.sleep(1)
    raise TimeoutError("리뷰 엑셀 다운로드 파일을 찾지 못했습니다.")


def download_with_selenium(profile_dir, headless=False):
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
    except ImportError as error:
        raise RuntimeError(
            "selenium이 설치되어 있지 않습니다. 먼저 실행: "
            "python3 -m pip install selenium"
        ) from error

    options = Options()
    options.add_argument(f"--user-data-dir={profile_dir}")
    options.add_experimental_option("prefs", {
        "download.default_directory": str(DOWNLOAD_DIR),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    })
    if headless:
        options.add_argument("--headless=new")

    driver = webdriver.Chrome(options=options)
    driver.set_window_size(1440, 1100)
    start_time = time.time()
    try:
        driver.get(REVIEW_URL)
        input("스마트스토어 로그인/필터 설정 후 엔터를 누르면 엑셀 다운로드 버튼을 찾습니다: ")

        button_xpaths = [
            "//button[contains(., '엑셀')]",
            "//a[contains(., '엑셀')]",
            "//button[contains(., '다운로드')]",
            "//a[contains(., '다운로드')]",
            "//button[contains(., 'Excel')]",
            "//a[contains(., 'Excel')]",
            "//button[contains(., '내보내기')]",
            "//a[contains(., '내보내기')]",
        ]
        clicked = False
        for xpath in button_xpaths:
            buttons = driver.find_elements(By.XPATH, xpath)
            visible = [button for button in buttons if button.is_displayed() and button.is_enabled()]
            if visible:
                visible[0].click()
                clicked = True
                break
        if not clicked:
            raise RuntimeError("화면에서 엑셀/다운로드 버튼을 찾지 못했습니다.")

        return wait_for_download(start_time)
    finally:
        driver.quit()


def process_file(input_path):
    safe_rows = sanitize_reviews(input_path)
    mentions = build_mentions(safe_rows)

    safe_path = PROCESSED / "smartstore_reviews_sanitized.csv"
    mentions_path = PROCESSED / "smartstore_review_mentions.csv"
    write_csv(safe_path, safe_rows, SAFE_FIELDS)
    write_csv(mentions_path, mentions, MENTION_FIELDS)
    print(f"saved {safe_path} rows={len(safe_rows)}")
    print(f"saved {mentions_path} rows={len(mentions)}")
    print("개인정보성 항목은 저장하지 않았습니다.")


def process_files(input_paths):
    all_rows = []
    seen = set()
    for input_path in input_paths:
        for row in sanitize_reviews(input_path):
            dedupe_key = (
                row.get("review_date", ""),
                row.get("product_name", ""),
                row.get("option_name", ""),
                row.get("rating", ""),
                row.get("review_text", ""),
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            all_rows.append(row)

    mentions = build_mentions(all_rows)
    safe_path = PROCESSED / "smartstore_reviews_sanitized.csv"
    mentions_path = PROCESSED / "smartstore_review_mentions.csv"
    write_csv(safe_path, all_rows, SAFE_FIELDS)
    write_csv(mentions_path, mentions, MENTION_FIELDS)
    print(f"saved {safe_path} rows={len(all_rows)}")
    print(f"saved {mentions_path} rows={len(mentions)}")
    print("개인정보성 항목은 저장하지 않았습니다.")


def main():
    parser = argparse.ArgumentParser(description="Collect privacy-safe Smartstore review data.")
    parser.add_argument("--file", help="이미 내려받은 리뷰 엑셀/CSV 파일 경로를 정리합니다.")
    parser.add_argument("--dir", help="폴더 안의 리뷰 엑셀/CSV 파일을 모두 합쳐 정리합니다.")
    parser.add_argument("--download", action="store_true", help="스마트스토어 리뷰 페이지에서 엑셀 다운로드를 자동 실행합니다.")
    parser.add_argument("--profile-dir", default=str(RAW_DIR / "chrome-profile"), help="로그인 세션을 저장할 Chrome 프로필 경로")
    parser.add_argument("--headless", action="store_true", help="브라우저를 headless로 실행합니다. 최초 로그인 시에는 권장하지 않습니다.")
    args = parser.parse_args()

    ensure_dirs()
    if args.file:
        process_file(Path(args.file).expanduser().resolve())
        return
    if args.dir:
        input_dir = Path(args.dir).expanduser().resolve()
        input_paths = sorted([
            path for path in input_dir.iterdir()
            if path.is_file() and path.suffix.lower() in {".xlsx", ".xls", ".csv"}
        ])
        if not input_paths:
            raise FileNotFoundError(f"정리할 리뷰 파일이 없습니다: {input_dir}")
        process_files(input_paths)
        return
    if args.download:
        downloaded = download_with_selenium(Path(args.profile_dir).expanduser().resolve(), args.headless)
        print(f"downloaded {downloaded}")
        process_file(downloaded)
        return
    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
