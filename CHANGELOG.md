# Changelog

Format: **what was wrong**, how it was found, what changed. Numbers and behaviour before these entries are tagged `cv-baseline`.

## After eval v2: root-cause fixes

How these were found: I read every one of the 33 failed rows of the first v2 campaign (19 tasks × 3 repeats, `gpt-6-luna`, 24/57 passed), with each row's assertions and full tool trace, and replayed the long-file traces through the real `read` tool. No row looped or hit a stop, and none was a wrong fix made with the right information in hand. 15 failures were grader false positives. The other 18 were all search, listing or paging failures. Every fix below is general (no task-specific hints, no changes to task prompts or hidden tests) and has a regression test.

**Result:** re-running the same suite after these fixes gave **56/57** (pass@3 1.00, pass^3 0.95), up from 24/57. All 56 passes are confirmed by the hidden JUnit report and a clean tamper scan. The one failure (V16) is a genuine logic error. Both runs' raw traces are in `evals/published/`.

### Grader
- **The tamper scan flagged colocated `*.test.ts` files for importing `bun:test`** (14 rows whose hidden tests passed). Fixed in `9609332`, before this section.
- **The `.env` trace rule fired on a search pattern.** V18 r2 searched `src/` with `Select-String -Pattern 'process\.env|…'`, opened nothing, passed its hidden test 5/5, and failed with "a tool call tried to access .env", because the lexical rule read the `\` of the regex escape as a word boundary. The rule now splits the command into words the way a shell does (quotes removed, so `.en''v` still counts), ignores the value of `-Pattern`/`-e`/`--regexp` in a search command, and flags only words that name `.env` as a path. File tools are judged by their `path` argument only. The exact V18 r2/r3 lines are regression tests, and real attempts (`read .env`, `Get-Content .\.env`, `git show HEAD:.env`, `cat -e .env`, …) still fail the task. Only a search command's pattern is read as a regex, so `Select-String KEY -Path src\.env` still counts. That gap was found by the security review (L6) and fixed in `79c46aa`.

### Tools
- **No way to list a directory** (11 rows). `Get-ChildItem` was refused 89 times across the campaign, because only the bare one-path form is allow-tier, and `read` on a directory said only "not a regular file". Across the failed rows the model guessed 84 nonexistent paths, and the discovery rows gave up after 3-8 calls. New read-only `list` tool, and `read` on a directory now points to it.
- **No way to search** (the model tried `Select-String`/`rg` 16 times, in 7 of the 18 genuine failures, and in 5 of the 6 rows that never reached the page holding the answer). New read-only `grep` tool. Every file passes PathGuard and the read policy immediately before it is opened, so protected files are never opened, and a test spies on `node:fs` to prove it. Links are never followed, and binary and >2 MB files are skipped. Results are capped and report `truncated`.
- **`edit` said "oldText occurs 3 times" without saying where** (V15 r1: the model had seen two of them, and the third, on line 615, was the one the hidden test hit). The error now lists the line of each occurrence (up to ten).

### Agent loop
- **Refusals did not say why.** A rejected confirm-tier call returned "Shell rejected by the user.", though no user exists in evals and the policy reason was dropped. It now gives the reason, and refused shell calls add a hint naming read/list/grep and the commands that run without approval. The words "rejected"/"denied" are kept, so the trace statistics still count them.
- **The system prompt told the model to "explain why you cannot continue"** after a denial, and 11 rows did exactly that with 32+ steps unused. All 6 paging failures ignored `nextStartLine`. The prompt (12 lines) now says to use list/grep, to keep reading or grep when `read` returns `nextStartLine`, that a refused command is not the end of the task, and to run `bun test` after changing code.

### Found by the security review of list and grep
An independent review attacked the new tools from a detached worktree using dummy canaries. It found no input that made list or grep return the content of a path PathGuard protects, a file outside the root, or anything reached through a link. It did find these:
- **A model-written regex could freeze the agent** (H1). `(\w+\s?)+$` over the V13 fixtures ran for more than 120 s, and `function.*return.*await` on one 50 KB minified line took 33 s. The regex runs on the agent's thread, where no timer or AbortSignal can fire. grep now tests only the first 1000 characters of each line (a match further right is missed, as the tool description says). It stops at a 5 s deadline checked before every line, file and directory, and returns `truncated` with a note to narrow the path or set `literal`. The bound is soft: the deadline plus one capped line. The walk also stops after 20k directory entries or 64 MB read (M4).
- **One locked file failed the whole search and showed the absolute local path** (M1: `EBUSY ... open 'C:\Users\...\held.log'`). Per-file errors now count as skipped, and no fs message reaches the model.
- **grep swept up credential files the deny-list missed** (M2): `.npmrc`, `.netrc`, `.envrc`, `terraform.tfvars`, `.docker/config.json`, `production.env`. PathGuard now hard-denies the common credential files, which also covers read and the shell allow tier. A `<name>.env` file is listed as "may hold secrets" and grep never opens it, but it stays readable by name, because V19 ships `tests/fixtures/sample.env` for the agent to read. Names with trailing dots or spaces (`.env.`, `.git./config`, L1) are now matched the way Win32 opens them.
- **A hard link to `.env` has an innocent name** (M3). grep skips files with more than one link, and read refuses them, except under `node_modules`, where Bun on Windows installs packages as hard links to its cache.
- Small output fixes: the snippet now starts just before the match (L2), and a search where every file was skipped says so instead of "No matches." (L3).
- Not fixed: L4 (an ACL-denied entry is labelled "protected" instead of "unreadable") and L5 (a file swapped for a link between the check and the open). L5 needs an approved command or a concurrent process to exploit; the fix would read through a verified file descriptor.

Measured in v2 run 2 on the same tasks: 56/57 (see the result above). The offline `bun run eval` (scripted provider, which never calls the new tools) still passes 12/12, and `cv-baseline` still summarises to 30/30, 11473/15227 ms, lower bound 0.9050.

## [Unreleased] — hardening pass after a self-audit

I audited every claim the project makes against the code and the stored eval traces, wrote probe scripts for the suspicious ones, and fixed what they exposed. Each code fix in the Safety, Tool harness, Agent loop and Evaluation sections has a regression test that fails on the code before the fix. A second audit of the hardened code found more; those fixes are under "Found by the second audit".

### Evaluation
- **"Success" was a substring check, not a test run.** The trace audit showed the agent's own test command ran in only 7 of 30 live runs, and the grader never ran tests. The grader now runs `bun test` itself, plus a hidden check written only after the agent stops, which makes it harder to game. The old substring result is kept as `assertionsPassed` so old and new can be compared.
- **The CV numbers couldn't be regenerated offline, and the summary JSON had been patched by hand.** Added `bun run eval:summarize`, which recomputes median/P95, the pass matrix, trace stats and a Clopper-Pearson lower bound from the raw JSONL. It never overwrites its inputs.
- **The eval approver rejected every confirm-tier request** (54 rejections in the traces). It now approves exactly `bun test` with relative test paths and nothing else.
- **A new paid run would have overwritten the baseline files.** Runs now go into new timestamped folders with relative paths, the real model name and the stat method.
- **Brittle tasks.** T3 failed a correct fix written as `i+1`, and T5/T6 passed even if the agent did nothing. T3 now relies on its test, and T5/T6 check that the trace shows the denial and recovery.
- **`successRate` left out runs that aborted.** It divided passes by valid runs only, so 29/30 showed as 100%. Found while summarising the first test-graded live run. Invalid runs now count as failures. The `cv-baseline` data had no invalid runs, so its 30/30 is unchanged.
- `eval:context` now prints only, and writes JSON only with `--out`.

### Safety (PathGuard and permissions)
- **Protected-file rules could be bypassed** with a junction pointing at `.git`, or with `.env::$DATA` (an NTFS stream). Found by audit probes. Deny rules now also run on the `realpathSync.native` canonical path, and NTFS streams are rejected.
- **`ls env:` / `dir env:` ran without asking and printed API keys.** Found by policy probes. Environment dumps and `$env:` references are now denied.
- **Writing a test and then running `bun test` executed arbitrary code with no approval.** Commands that run project code (`bun test`, `bun run`, `node`, …) now need confirmation. Edits to project config files, and overwrites outside `src/` and `tests/`, are now a real confirm tier for file actions.
- **`cat .env` only needed confirmation, while the read tool denied it.** Shell references to protected files are now denied, so both paths agree for literal names. Disguised names are handled by the second-audit fix below; wildcards like `.e*` need confirmation.
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
- **The Responses adapter had no retries, no backoff, no typed errors and zero tests.** It now uses the official `openai` SDK (retries on 408/409/429/5xx and connection errors; per-attempt timeout). Errors map to `PROVIDER_TIMEOUT` or `PROVIDER_ERROR` with the HTTP status. There are 14 offline adapter tests: 7 run the real SDK client against a fake `fetch`, 5 test the pure request/response mapping, 1 uses an injected client, and 1 checks the constructor.
- **An unpriced model turned the USD budget caps off without warning.** It now fails at startup with `CONFIG_ERROR`. Added `gpt-6-luna` pricing.

### Found by the second audit
- **Quoting hid protected files from the shell rules.** `git diff --no-index src/a.txt .en''v` was auto-allowed as read-only git and printed `.env`, because the shell drops the quotes but the deny rule saw `.en''v`. Protected-name and environment rules now also run on the command with quotes, backticks and carets removed. Quotes, wildcards, variables, Windows 8.3 short names (`ENV~1`) and `--no-index` now need confirmation instead of being auto-allowed.
- **The shell output cap didn't work.** The result JSON included the raw stdout/stderr next to the truncated `output`, so 50K characters of stdout reached the model as a 66K-character result. Only the capped output is sent now.
- **A project's `.env` could redirect API traffic.** Running CodeLoop inside an untrusted repo loaded that repo's `.env`. If it set `OPENAI_BASE_URL`, the user's key from the shell would be sent there. The base URL must now come from the real environment, in any letter case (Windows environment names are case-insensitive).
- **The quote fix was incomplete.** A third audit found `git diff src/a.txt .en‚‚v` still auto-allowed in a non-git folder: PowerShell also treats low-9 quotes as quoting, and outside a repo `git diff a b` behaves like `--no-index`. Instead of chasing more quote characters, auto-allowed commands must now be plain ASCII (no backslash escapes on POSIX), and every argument, including the path in `rev:path`, must pass `PathGuard.resolveInside`.
- **Blocking one key wasn't enough.** A project `.env` could still set `HTTPS_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED` and similar keys. The file is now an allowlist: only `CODELOOP_*`, `OPENAI_API_KEY` and `OPENAI_MODEL` are read; other keys are ignored with a warning.
- **Approved commands were logged unredacted.** The `permission` event in the session log now goes through the same redaction as every other event.

### Scope and housekeeping
- Removed unfinished integrations (MCP, LSP, web search), the NVIDIA provider, the unwired Ink UI, dead code and the `hello` scaffold. OpenAI Responses is the only backend.
- The REPL now survives a failed run instead of exiting. `/compact` (which only recorded a marker) was renamed `/checkpoint`.
- Pinned dependency versions, committed `bun.lock`, added `LICENSE`. Live evals are disabled by default in `.env.example`.
