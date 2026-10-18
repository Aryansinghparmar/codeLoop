# Published evaluation evidence

Raw per-run results (one JSON object per task attempt, including the full tool trace) for two live evaluation campaigns. Every number quoted for this project can be recomputed offline from these files:

```bash
bun run eval:summarize --dir evals/published/cv-baseline
bun run eval:summarize --dir evals/published/2026-10-18-test-graded
```

No API key or network access is needed.

## Campaigns

| | `cv-baseline` | `2026-10-18-test-graded` |
|---|---|---|
| Code | tag `cv-baseline` | commit `bca32b9`, after the first hardening pass. The "second audit" fixes in `CHANGELOG.md` came later and are not reflected; the stricter shell rule would probably add a few eval refusals (not re-run). |
| Model | `gpt-5.6-luna` | `gpt-6-luna` |
| Tasks × repeats | 10 live tasks × 3 | 10 live tasks × 3 |
| How a pass was graded | substring checks on the files the agent left | file checks **and** the grader runs `bun test` itself, including a hidden test it writes after the agent stops |
| Pass rate | 30/30 | 29/30 (one run aborted by the repeated-failure breaker) |
| 95% one-sided lower bound (Clopper-Pearson) | 0.905 | 0.851 |
| Agent's own test command ran and passed | 7/30 runs | 29/30 runs |
| Failed tool calls | 148/233 | 61/162 |
| Median latency (pooled, valid runs) | 11.47 s | 9.64 s |
| P95 latency (nearest-rank, valid runs) | 15.23 s | 34.59 s |
| Max latency | 20.93 s | 77.38 s |
| Estimated cost (local price table) | $0.0386 | $0.0166 |

## How to read these numbers
- **Median** is the midpoint of the two middle values. **P95** is nearest-rank: with 29–30 samples it is essentially the second-slowest run, so it is noisy.
- **Repeats of the same task are correlated**, so the confidence bounds are optimistic. The effective sample size is closer to 10 tasks than to 30 runs.
- **The tasks are small** (create a function with a test, fix a one-line bug, rename a symbol). This is a smoke-level reliability check, not a benchmark.
- **Latency** is the wall-clock time of one agent run: model calls plus tool execution. It depends on the provider's load on that day.
- **Cost** comes from a local price table (`src/llm/pricing.ts`), not from a bill.
- **The slowest runs in the second campaign are task T4** (a rename across two files): the max (77.4 s) and 3 of the 4 slowest. With no read-only search tool, the agent tries to find usages with shell pipelines; the policy refuses those, so it falls back to guessing file paths. A read-only grep/list tool is the obvious next step. The P95 sample (34.6 s) is a T10 run with 4 steps and no failed calls, so it most likely reflects provider latency.

## Provenance
- These files are copies of the local result files. Local temp paths are replaced with `<tmp>/` and nothing else is changed. Scanned for keys, tokens and user paths before publishing.
- In the `cv-baseline` campaign, the stored summary JSON (not published here) was edited by hand after the run to switch its aggregate from "mean of per-run medians / max of per-run P95s" to pooled statistics. The raw JSONL was never edited. `eval:summarize` now regenerates the summary from these raw files, so no hand-maintained summary is needed.
