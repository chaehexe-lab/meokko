#!/usr/bin/env python3
"""
Run the weekly dashboard data update from locally downloaded source files.

This script does not log in to Smartstore or download private data by itself.
Managers place exported files under data/raw/, then this script rebuilds
privacy-safe dashboard datasets and writes an update log.
"""

import csv
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_DIR = ROOT / "data" / "raw" / "smartstore_reviews" / "downloads"
PROCESSED = ROOT / "data" / "processed"
LOG_PATH = PROCESSED / "dashboard_data_update_log.csv"


def count_csv(path):
    if not path.exists():
        return 0
    with path.open(encoding="utf-8-sig", newline="") as f:
        return sum(1 for _ in csv.DictReader(f))


def write_log(row):
    PROCESSED.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "updated_at",
        "status",
        "input_files",
        "smartstore_review_rows",
        "smartstore_mention_rows",
        "reaction_signal_rows",
        "note",
    ]
    exists = LOG_PATH.exists()
    with LOG_PATH.open("a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def run(command):
    subprocess.run(command, cwd=ROOT, check=True)


def main():
    updated_at = datetime.now().isoformat(timespec="seconds")
    input_files = sorted([
        path for path in DOWNLOAD_DIR.glob("*")
        if path.is_file() and path.suffix.lower() in {".xlsx", ".xls", ".csv"}
    ])

    if not input_files:
        write_log({
            "updated_at": updated_at,
            "status": "failed",
            "input_files": 0,
            "smartstore_review_rows": 0,
            "smartstore_mention_rows": 0,
            "reaction_signal_rows": 0,
            "note": f"input files not found: {DOWNLOAD_DIR}",
        })
        raise FileNotFoundError(f"input files not found: {DOWNLOAD_DIR}")

    try:
        run([sys.executable, "scripts/collect_smartstore_reviews_auto.py", "--dir", str(DOWNLOAD_DIR)])
        run([sys.executable, "scripts/build_public_web_reaction_dataset.py"])

        review_rows = count_csv(PROCESSED / "smartstore_reviews_sanitized.csv")
        mention_rows = count_csv(PROCESSED / "smartstore_review_mentions.csv")
        signal_rows = count_csv(PROCESSED / "public_web_reaction_signals.csv")

        write_log({
            "updated_at": updated_at,
            "status": "success",
            "input_files": len(input_files),
            "smartstore_review_rows": review_rows,
            "smartstore_mention_rows": mention_rows,
            "reaction_signal_rows": signal_rows,
            "note": "weekly dashboard data update completed",
        })
        print(f"updated_at={updated_at}")
        print(f"input_files={len(input_files)}")
        print(f"smartstore_review_rows={review_rows}")
        print(f"smartstore_mention_rows={mention_rows}")
        print(f"reaction_signal_rows={signal_rows}")
    except Exception as error:
        write_log({
            "updated_at": updated_at,
            "status": "failed",
            "input_files": len(input_files),
            "smartstore_review_rows": 0,
            "smartstore_mention_rows": 0,
            "reaction_signal_rows": 0,
            "note": str(error),
        })
        raise


if __name__ == "__main__":
    main()
