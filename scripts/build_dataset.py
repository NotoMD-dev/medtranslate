#!/usr/bin/env python3
"""
Build a unified translation dataset from ClinSpEn and UMass EHR sources.

Usage:
    python build_dataset.py \
        --clinspen data/clinspen/clinspen_corpora_complete/clinspen_clinicalcases \
        --umass data/umass_ehr_pairs.txt \
        --output data/unified_translation_dataset.csv
"""

import argparse
import csv
import glob
import os
import sys


def process_clinspen(base_path: str) -> list[dict]:
    """Extract sentence-aligned EN-ES pairs from ClinSpEn clinical case files."""
    rows = []
    for folder in ["clinspen_clinicalcases_sample-set", "clinspen_clinicalcases_test-set"]:
        path = os.path.join(base_path, folder)
        if not os.path.isdir(path):
            print(f"  Warning: {path} not found, skipping")
            continue

        en_files = sorted(glob.glob(os.path.join(path, "*.en.txt")))
        for en_file in en_files:
            doc_id = os.path.basename(en_file).replace(".en.txt", "")
            es_file = en_file.replace(".en.txt", ".es.txt")
            if not os.path.exists(es_file):
                continue

            with open(en_file, "r", encoding="utf-8") as f:
                en_lines = [l.strip() for l in f.readlines()]
            with open(es_file, "r", encoding="utf-8") as f:
                es_lines = [l.strip() for l in f.readlines()]

            for i, (en, es) in enumerate(zip(en_lines, es_lines)):
                if en and es and len(en) > 10 and len(es) > 10:
                    rows.append({
                        "pair_id": f"clinspen_{doc_id}_L{i+1}",
                        "source": "ClinSpEn_ClinicalCases",
                        "content_type": "clinical_case_report",
                        "english_reference": en,
                        "spanish_source": es,
                        "llm_english_translation": "",
                    })
    return rows


def process_umass(file_path: str) -> list[dict]:
    """Extract EN-ES pairs from UMass EHR tab-separated file."""
    rows = []
    skip_patterns = [
        "___", "**", "Dictator:", "Job ID:",
        "Electronically Signed", "INITIALS D:",
    ]

    with open(file_path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 2:
                continue

            en, es = parts[0].strip(), parts[1].strip()
            if not en or not es or len(en) <= 10 or len(es) <= 10:
                continue

            if any(en.startswith(p) or p in en for p in skip_patterns):
                continue

            rows.append({
                "pair_id": f"umass_ehr_L{i}",
                "source": "UMass_EHR",
                "content_type": "ehr_clinical_note",
                "english_reference": en,
                "spanish_source": es,
                "llm_english_translation": "",
            })
    return rows


def main():
    parser = argparse.ArgumentParser(
        description="Build unified translation dataset from ClinSpEn and UMass EHR"
    )
    parser.add_argument(
        "--clinspen", required=True,
        help="Path to ClinSpEn clinical cases directory"
    )
    parser.add_argument(
        "--umass", required=True,
        help="Path to UMass EHR pairs file (tab-separated)"
    )
    parser.add_argument(
        "--output", default="data/unified_translation_dataset.csv",
        help="Output CSV path"
    )
    args = parser.parse_args()

    print("Processing ClinSpEn corpus...")
    clinspen_rows = process_clinspen(args.clinspen)
    print(f"  ClinSpEn pairs: {len(clinspen_rows)}")

    print("Processing UMass EHR pairs...")
    umass_rows = process_umass(args.umass)
    print(f"  UMass EHR pairs: {len(umass_rows)}")

    all_rows = clinspen_rows + umass_rows
    print(f"\nTotal pairs: {len(all_rows)}")

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    fieldnames = [
        "pair_id", "source", "content_type",
        "english_reference", "spanish_source", "llm_english_translation",
    ]
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Saved to: {args.output}")


if __name__ == "__main__":
    main()
