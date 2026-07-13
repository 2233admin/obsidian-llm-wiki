# Evaluation

LLM Wiki evaluates the reviewed-memory pipeline in two layers:

1. Local scorecard for deterministic retrieval and citation checks.
2. Optional external judges for RAG answer quality.

The local scorecard is the merge gate. External judges are adapters, not the
source of truth.

## Tool Map

| Tool | Use | Boundary |
|---|---|---|
| Ragas | Faithfulness, answer relevancy, context precision/recall | Optional judge/export target |
| DeepEval | CI-friendly LLM eval tests and faithfulness metrics | Optional judge/export target |
| RAGChecker | Fine-grained RAG diagnosis | Optional diagnostic run |
| Phoenix / TruLens | Tracing and production observability | Optional runtime telemetry |
| LLM Wiki scorecard | Retrieval hit rate, MRR, precision, citation coverage | Built in |

## Dataset

Use JSONL. One case per line:

```json
{"id":"q1","question":"What is the review path?","expected_paths":["20-Decisions/review.md"],"retrieved":[{"path":"20-Decisions/review.md","content":"Reviewed knowledge is promoted by PR."}],"answer":"Reviewed knowledge is promoted through PR review.","citations":["20-Decisions/review.md"]}
```

Fields:

- `id`: stable case id.
- `question`: user query.
- `expected_paths`: relevant paths, when known.
- `retrieved`: ranked retrieved contexts. Each item has `path` and optional `content`.
- `answer`: generated answer, optional.
- `citations`: paths cited by the answer, optional.
- `reference`: gold answer, optional for external judges.

## Local Scorecard

```bash
python scripts/rag_eval.py eval/rag-smoke.example.jsonl --json
```

Metrics:

- `hit_rate`: at least one expected path appeared in retrieved contexts.
- `mrr`: mean reciprocal rank of the first expected path.
- `precision_at_k`: fraction of top-k retrieved paths that were expected.
- `citation_coverage`: cited paths that appeared in retrieved contexts.
- `answer_presence`: cases with non-empty answers.

## External Export

Ragas style:

```bash
python scripts/rag_eval.py eval/rag-smoke.example.jsonl --export-ragas ragas.jsonl
```

DeepEval style:

```bash
python scripts/rag_eval.py eval/rag-smoke.example.jsonl --export-deepeval deepeval.jsonl
```

The exported files intentionally contain simple `question`, `answer`,
`contexts`, and `ground_truth` fields so downstream tools own their own model
configuration and judge prompts.

## Gate

For a small regression set:

```bash
python scripts/rag_eval.py eval/rag-smoke.example.jsonl --min-hit-rate 0.8 --min-citation-coverage 0.8
```

The gate should be strict on retrieval and citation plumbing. LLM-as-judge
scores are useful for diagnosis, but they should not be the only release gate.
