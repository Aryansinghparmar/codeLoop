# Published evaluation evidence

Raw per-run results (one JSON object per task attempt, including the full tool trace) for four live evaluation campaigns (two on the v1 tasks, two on the harder v2 suite, described below). Every number quoted for this project can be recomputed offline from these files:

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
- **The slowest runs in the second campaign are task T4** (a rename across two files): the max (77.4 s) and 3 of the 4 slowest. With no read-only search tool, the agent tries to find usages with shell pipelines; the policy refuses those, so it falls back to guessing file paths. A read-only grep/list tool was the obvious next step; it was added later (see Eval v2 below). The P95 sample (34.6 s) is a T10 run with 4 steps and no failed calls, so it most likely reflects provider latency.

## Provenance
- These files are copies of the local result files. Local temp paths are replaced with `<tmp>/` and nothing else is changed. Scanned for keys, tokens and user paths before publishing.
- In the `cv-baseline` campaign, the stored summary JSON (not published here) was edited by hand after the run to switch its aggregate from "mean of per-run medians / max of per-run P95s" to pooled statistics. The raw JSONL was never edited. `eval:summarize` now regenerates the summary from these raw files, so no hand-maintained summary is needed.

## Eval v2: harder suite with hidden tests (2026-10-19)

19 tasks (`src/evaluation/tasks-v2*.ts`):
- multi-file bug fixes; "make the suite pass" tasks where the bug isn't where the failing test points; small features; multi-file refactors; long files; long-context reading; two safety tasks.

How the grading works:
- Every task is graded by **hidden behavioural tests**, written after the agent stops and run in an isolated copy via bun's JUnit reporter, with matcher sentinels and a tamper scan.
- Offline validity tests prove each task **fails untouched** and **passes with a reference solution**.
- The suite was designed by one agent and red-teamed by another before any paid run (1 blocker, 6 high findings, all fixed).
- Same model `gpt-6-luna`, 3 repeats, max 40 steps.

```bash
CODELOOP_EVAL_SUITE=v2 CODELOOP_LIVE_CONFIRM=yes bun run eval:repeat     # live, paid
bun run eval:summarize --dir evals/published/2026-10-19-v2-run2-final   # offline
```

| | `2026-10-19-v2-run1-grader-bug` | `2026-10-19-v2-run2-final` |
|---|---|---|
| Pass rate | 24/57 (42.1%) | **56/57 (98.2%)** |
| pass@1 / pass@3 / pass^3 | 0.421 / 0.632 / 0.211 | **0.982 / 1.000 / 0.947** |
| 95% lower bound (Clopper-Pearson) | 0.310 | 0.920 |
| Median / P95 latency | 27.4 s / 79.4 s | 22.2 s / 47.7 s |
| Failed tool calls | 321/776 | 47/822 |
| Shell calls refused | 106 | 0 |
| Compaction fired | 0 runs | 0 runs |
| Estimated cost | $0.448 | $0.344 |

**Why run 1 is not a measure of the agent.** A root-cause analysis of all 33 failures found 15 grader false positives:
- 14 times the tamper scan flagged the agent's own legitimate `*.test.ts` files;
- once, the `.env` rule matched the text `process\.env`.

The other 18 failures were all the agent being unable to find code. With no list or search tool, its shell searches were refused and it gave up, or it didn't page through long files. There were no wrong fixes and no loops.

**What changed between the runs** (see `CHANGELOG.md`, "After eval v2"):
- both grader false positives fixed, each with a regression test;
- new read-only `list` and `grep` tools (PathGuard on every file; security-reviewed);
- refusal messages that explain the alternative;
- prompt guidance.

(Before run 1, a smoke run had already exposed a `read` bug, and it was fixed then: `read` cut the middle out of long files while reporting the full line range. It now pages by whole lines. So that fix is in both runs.)

No task prompt or hidden test changed.

**Run 2's single failure** is genuine: V16 repeat 2 got the retry "attempt budget" logic wrong. All 56 passes are confirmed by the hidden JUnit report and a clean tamper scan.

**Caveats:**
- 19 tasks × 3 correlated repeats is still a small sample.
- The tasks are synthetic, though harder than v1.
- **Compaction never fired.** With `grep`, the agent reads only what it needs, and the peak context stayed under the 32K budget.
