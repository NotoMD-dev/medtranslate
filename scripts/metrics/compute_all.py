#!/usr/bin/env python3
"""
Compute publication-quality translation metrics (BLEU, METEOR, BERTScore).

This script produces the metrics for the research paper. The web interface
computes approximate scores; this script uses the standard NLP libraries.

Usage:
    python compute_all.py \
        --input ../../data/results_with_translations.csv \
        --output ../../data/results_with_metrics.csv

Output columns added:
    bleu_score, meteor_score, bert_precision, bert_recall, bert_f1
"""

import argparse
import sys

import nltk
import pandas as pd
from bert_score import score as bert_score
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from nltk.translate.meteor_score import single_meteor_score

# Download required NLTK data
nltk.download("wordnet", quiet=True)
nltk.download("punkt", quiet=True)
nltk.download("punkt_tab", quiet=True)
nltk.download("omw-1.4", quiet=True)


def compute_bleu(candidate: str, reference: str) -> float:
    """Compute sentence-level BLEU with smoothing."""
    ref_tokens = nltk.word_tokenize(reference.lower())
    cand_tokens = nltk.word_tokenize(candidate.lower())
    if not cand_tokens or not ref_tokens:
        return 0.0
    smoothie = SmoothingFunction().method1
    return sentence_bleu(
        [ref_tokens], cand_tokens,
        weights=(0.25, 0.25, 0.25, 0.25),
        smoothing_function=smoothie,
    )


def compute_meteor(candidate: str, reference: str) -> float:
    """Compute METEOR score with synonym matching."""
    ref_tokens = nltk.word_tokenize(reference.lower())
    cand_tokens = nltk.word_tokenize(candidate.lower())
    if not cand_tokens or not ref_tokens:
        return 0.0
    return single_meteor_score(ref_tokens, cand_tokens)


def main():
    parser = argparse.ArgumentParser(description="Compute translation metrics")
    parser.add_argument("--input", required=True, help="CSV with translations")
    parser.add_argument("--output", required=True, help="Output CSV with metrics")
    parser.add_argument("--batch-size", type=int, default=64, help="BERTScore batch size")
    args = parser.parse_args()

    df = pd.read_csv(args.input)

    # Validate columns
    required = ["english_reference", "llm_english_translation"]
    for col in required:
        if col not in df.columns:
            print(f"Error: missing column '{col}'")
            sys.exit(1)

    # Filter to rows with both reference and translation
    mask = df["english_reference"].notna() & df["llm_english_translation"].notna()
    mask &= df["llm_english_translation"].str.len() > 0
    mask &= ~df["llm_english_translation"].str.startswith("ERROR")
    valid = df[mask].copy()
    print(f"Computing metrics for {len(valid)} of {len(df)} rows")

    # BLEU
    print("Computing BLEU...")
    valid["bleu_score"] = valid.apply(
        lambda r: compute_bleu(r["llm_english_translation"], r["english_reference"]),
        axis=1,
    )

    # METEOR
    print("Computing METEOR...")
    valid["meteor_score"] = valid.apply(
        lambda r: compute_meteor(r["llm_english_translation"], r["english_reference"]),
        axis=1,
    )

    # BERTScore
    print("Computing BERTScore (this may take a while)...")
    candidates = valid["llm_english_translation"].tolist()
    references = valid["english_reference"].tolist()
    P, R, F1 = bert_score(
        candidates, references,
        lang="en",
        batch_size=args.batch_size,
        verbose=True,
    )
    valid["bert_precision"] = P.numpy()
    valid["bert_recall"] = R.numpy()
    valid["bert_f1"] = F1.numpy()

    # Merge back
    for col in ["bleu_score", "meteor_score", "bert_precision", "bert_recall", "bert_f1"]:
        df[col] = None
    df.loc[valid.index, "bleu_score"] = valid["bleu_score"]
    df.loc[valid.index, "meteor_score"] = valid["meteor_score"]
    df.loc[valid.index, "bert_precision"] = valid["bert_precision"]
    df.loc[valid.index, "bert_recall"] = valid["bert_recall"]
    df.loc[valid.index, "bert_f1"] = valid["bert_f1"]

    df.to_csv(args.output, index=False)

    # Print summary
    print("\n=== SUMMARY ===")
    print(f"Total rows: {len(df)}")
    print(f"Scored rows: {len(valid)}")
    print(f"BLEU   mean: {valid['bleu_score'].mean():.4f}  std: {valid['bleu_score'].std():.4f}")
    print(f"METEOR mean: {valid['meteor_score'].mean():.4f}  std: {valid['meteor_score'].std():.4f}")
    print(f"BERT F1 mean: {valid['bert_f1'].mean():.4f}  std: {valid['bert_f1'].std():.4f}")

    if "source" in valid.columns:
        print("\n--- By Source ---")
        for src in valid["source"].unique():
            sub = valid[valid["source"] == src]
            print(f"\n{src} (n={len(sub)}):")
            print(f"  BLEU:    {sub['bleu_score'].mean():.4f} +/- {sub['bleu_score'].std():.4f}")
            print(f"  METEOR:  {sub['meteor_score'].mean():.4f} +/- {sub['meteor_score'].std():.4f}")
            print(f"  BERT F1: {sub['bert_f1'].mean():.4f} +/- {sub['bert_f1'].std():.4f}")

    print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
