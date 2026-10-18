# Changelog

Format: **what was wrong**, how it was found, what changed. Numbers and behaviour before these entries are tagged `cv-baseline`.

## [Unreleased] — hardening pass after a self-audit

I audited every claim the project makes against the code and the stored eval traces, wrote probe scripts for the suspicious ones, and fixed what they exposed. Each fix has a regression test that fails on the `cv-baseline` code.

### Evaluation
- **"Success" was a substring check, not a test run.** The trace audit showed the agent's own test command ran in only 7 of 30 live runs, and the grader never ran tests. The grader now runs `bun test` itself, plus a hidden check written only after the agent stops so it can't be gamed. The old substring result is kept as `assertionsPassed` so old and new can be compared.
- **The CV numbers couldn't be regenerated offline, and the summary JSON had been patched by hand.** Added `bun run eval:summarize`, which recomputes median/P95, the pass matrix, trace stats and a Clopper-Pearson lower bound from the raw JSONL. It never overwrites its inputs.
- **The eval approver rejected every confirm-tier request** (54 rejections in the traces). It now approves exactly `bun test` with relative test paths and nothing else.
- **A new paid run would have overwritten the baseline files.** Runs now go into new timestamped folders with relative paths, the real model name and the stat method.
- **Brittle tasks.** T3 failed a correct fix written as `i+1`, and T5/T6 passed even if the agent did nothing. T3 now relies on its test, and T5/T6 check that the trace shows the denial and recovery.
- `eval:context` now prints only, and writes JSON only with `--out`.

### Safety (PathGuard and permissions)
- **Protected-file rules could be bypassed** with a junction pointing at `.git`, or with `.env::$DATA` (an NTFS stream). Found by audit probes. Deny rules now also run on the `realpathSync.native` canonical path, and NTFS streams are rejected.
- **`ls env:` / `dir env:` ran without asking and printed API keys.** Found by policy probes. Environment dumps and `$env:` references are now denied.
- **Writing a test and then running `bun test` executed arbitrary code with no approval.** Commands that run project code (`bun test`, `bun run`, `node`, …) now need confirmation. Edits to project config files, and overwrites outside `src/` and `tests/`, are now a real confirm tier for file actions.
- **`cat .env` only needed confirmation, while the read tool denied it.** Shell references to protected files are now denied, so both paths agree.
- **Shell children inherited `OPENAI_API_KEY`.** The child environment is now an allowlist; key/token/secret/password names are always removed.
- **A timeout killed only the shell, so a hung grandchild kept the call waiting** (30 s in the new test against the old runner). The whole process tree is now killed (`taskkill /T /F` on Windows, process group on POSIX).
- The shell rules are now a named rule table, and each decision reports the `ruleId` that matched.

### Tool harness
- **The "exact-match" edit wasn't exact.** `String.replace` expands `$&`, `$'`, `` $` `` and `$$` in the replacement text. It now uses `indexOf` + `slice`; on the old code 10 of the 12 new tests fail.
- **Edits on CRLF files failed, and a missing file leaked the absolute local path.** Edit now matches using the file's own line endings, rejects no-op edits, and returns errors that tell the model what to do next.
- **`write` always reported `created: true`, even on overwrite.** It now reports `created`, `overwritten` and `previousBytes`.
- **`read` loaded whole files with no size or binary check.** It now checks the size first (2 MB cap), detects binary files, handles empty files and reports `totalLines`.
- **The permission check was copy-pasted into four tools, and `read` treated `confirm` as deny.** Replaced by one fail-closed `authorize()` helper.
- **Redaction printed the match offset (`OPENAI_API_KEY 31[REDACTED]`) and missed generic `*_API_KEY` names.** Fixed with a short list of named rules, plus tests that ordinary text is left alone.

### Agent loop and context compaction
- **Compaction could drop the current request in multi-turn sessions**, because it pinned only the first user message. It now also pins the latest user message and keeps the current turn when it fits.
- **The recency window could start on a tool output whose call had been cut**, which the Responses API rejects. The window now cuts only at turn boundaries.
- **Stage 2 deleted tool outputs, leaving calls without results.** It now masks the content and keeps the message. `bun run eval:context` still reports 74,151 → 20,632 estimated tokens.
- **`failure()` took 12 positional arguments.** Replaced by `RunStats`, `callModel`, `executeToolCall` and `RepeatedFailureTracker`, so `run()` reads top-down.
- **The model tried `npm test`, `pwd && ls` and `find` on Windows** (seen in live traces). The system prompt now states the OS, shell, project root, date and test runner, and what to do when a command is denied.
- **Malformed tool-call JSON silently became `{}`.** The provider now flags it, and the loop tells the model its arguments were invalid instead of running the tool.

### LLM provider
- **The Responses adapter had no retries, no backoff, no typed errors and zero tests.** It now uses the official `openai` SDK (retries on 408/409/429/5xx and connection errors; per-attempt timeout). Errors map to `PROVIDER_TIMEOUT` or `PROVIDER_ERROR` with the HTTP status. 14 offline tests run the real SDK client against a fake `fetch`.
- **An unpriced model turned the USD budget caps off without warning.** It now fails at startup with `CONFIG_ERROR`. Added `gpt-6-luna` pricing.

### Scope and housekeeping
- Removed unfinished integrations (MCP, LSP, web search), the NVIDIA provider, the unwired Ink UI, dead code and the `hello` scaffold. OpenAI Responses is the only backend.
- The REPL now survives a failed run instead of exiting. `/compact` (which only recorded a marker) was renamed `/checkpoint`.
- Pinned dependency versions, committed `bun.lock`, added `LICENSE`. Live evals are disabled by default in `.env.example`.
