"""Subprocess helper for BERTScore computation.

Reads candidates and references as JSON from stdin, computes BERTScore F1
in chunks, and writes progress + final results as JSON lines to stdout.
The process exits after each invocation, freeing the ~400MB RoBERTa model
from the main process memory.

Protocol (one JSON object per stdout line):
  {"type": "progress", "completed": N, "total": T, "scores": [...]}   — after each chunk (that chunk's F1 values)
  {"type": "done", "f1_scores": [...]}                — final output

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
    chunk_size = data.get("chunk_size", 500)
    batch_size = int(os.getenv("BERTSCORE_BATCH_SIZE", "64"))
    # Target language of the translations. English keeps roberta-base (the
    # model this app has always reported); any other language uses
    # bert-base-multilingual-cased. Keep in sync with bertscore_model() in
    # app/metrics.py.
    lang = data.get("lang") or "en"
    model_type = "roberta-base" if lang == "en" else "bert-base-multilingual-cased"

    if not candidates:
        print(json.dumps({"type": "done", "f1_scores": []}))
        sys.stdout.flush()
        return

    from bert_score import score as bert_score_fn

    total = len(candidates)
    all_f1: list[float] = []

    # Rescaling needs a baseline file for the model/language pair; bert_score
    # ships them for most languages but not all. Fall back to raw scores
    # when one is missing rather than failing the whole job.
    rescale = True

    for start in range(0, total, chunk_size):
        end = min(start + chunk_size, total)
        try:
            _P, _R, F1 = bert_score_fn(
                candidates[start:end],
                references[start:end],
                model_type=model_type,
                lang=lang,
                rescale_with_baseline=rescale,
                batch_size=batch_size,
                verbose=False,
            )
        except (FileNotFoundError, ValueError):
            if not rescale:
                raise
            rescale = False
            _P, _R, F1 = bert_score_fn(
                candidates[start:end],
                references[start:end],
                model_type=model_type,
                lang=lang,
                rescale_with_baseline=False,
                batch_size=batch_size,
                verbose=False,
            )
        chunk_scores = F1.tolist()
        all_f1.extend(chunk_scores)

        # Report progress after each chunk, with that chunk's scores so the
        # caller can fill rows in as they are computed.
        print(json.dumps({"type": "progress", "completed": len(all_f1), "total": total, "scores": chunk_scores}))
        sys.stdout.flush()

    # Final output with all scores
    print(json.dumps({"type": "done", "f1_scores": all_f1}))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
