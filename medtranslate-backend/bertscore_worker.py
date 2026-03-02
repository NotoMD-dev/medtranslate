"""Subprocess helper for BERTScore computation.

Reads candidates and references as JSON from stdin, computes BERTScore F1,
and writes the results as JSON to stdout. The process exits after each batch,
freeing the ~400MB RoBERTa model from the main process memory.

Usage:
    echo '{"candidates": [...], "references": [...]}' | python bertscore_worker.py
"""

import json
import os
import sys


def main() -> None:
    data = json.loads(sys.stdin.read())
    candidates = data["candidates"]
    references = data["references"]

    if not candidates:
        json.dump({"f1_scores": []}, sys.stdout)
        return

    batch_size = int(os.getenv("BERTSCORE_BATCH_SIZE", "64"))

    from bert_score import score as bert_score_fn

    _P, _R, F1 = bert_score_fn(
        candidates,
        references,
        model_type="roberta-base",
        lang="en",
        rescale_with_baseline=True,
        batch_size=batch_size,
        verbose=False,
    )

    json.dump({"f1_scores": F1.tolist()}, sys.stdout)


if __name__ == "__main__":
    main()
