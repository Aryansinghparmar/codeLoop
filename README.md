<p align="center">
  <h1 align="center">🔁 CodeLoop</h1>
  <p align="center">
    A safety-first terminal coding agent in TypeScript on Bun, built on the OpenAI Responses API.
    <br />
    Read → act → observe, in a loop, behind a permission layer, with a measurable eval harness.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/LLM-OpenAI%20Responses%20API-10a37f?style=flat-square" alt="OpenAI Responses API" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

---

## What it is

Give CodeLoop a coding task ("fix the off-by-one and run the test"). It loops: ask the model, run the tool calls the model requests (read, write, exact edit, shell), feed the results back, and stop when the model answers without calling a tool. Every tool call passes a path guard and a permission policy first, and the whole loop can be measured with an offline and a live evaluation suite.

## Architecture

```
 user ─► REPL (main.ts) ─► AgentLoop.run ───────────────────────────────────────┐
              ▲  approve? [y/N]   │ while steps < maxSteps                        │
              │                   ├─► ContextManager.reduce  (32K budget, chars/4)│
              │                   ├─► LlmProvider.complete ─► OpenAI Responses API (official SDK)
              │                   │        no tool calls? ─► done ────────────────┘
              │                   └─► ToolRegistry.execute(call)
              │                            └─► tool: read · write · edit · shell
              │                                 ├─ PathGuard.resolveInside  (realpathSync containment)
              └──────── confirm ◄───────────────├─ PermissionPolicy.evaluate (allow · confirm · deny)
                                                └─ filesystem / NativeProcessRunner (scrubbed env, tree kill)
                               tool result ◄── secret redaction · repeated-failure breaker
```

| Module | Responsibility |
|---|---|
| `src/agent/` | `AgentLoop`: the loop and its stop conditions. Done = no tool calls. It also stops at the step limit, on the same failure 3×, when the USD budget is hit, or on a provider error. |
| `src/llm/` | `LlmProvider` interface. `OpenAiResponsesProvider` adapter on the official `openai` SDK. `ScriptedProvider` and `MockProvider` for offline tests. Price table. |
| `src/tools/` | Tool contract, registry, and the `read`, `write`, `edit` (exact single match) and `shell` tools. One shared, fail-closed `authorize()` step. |
| `src/permissions/` | `PathGuard` (project-root containment via `realpathSync.native`, protected paths). `PermissionPolicy` (a named rule table: deny → confirm → allow, default confirm). |
| `src/context/` | `ContextManager`: two-stage compaction under a 32K-token budget. Stage 1 trims to a recent window at turn boundaries; stage 2 masks old tool outputs. |
| `src/evaluation/` | Fixed task suite, runner, test-executing grader, live/repeat CLIs, offline summariser, context benchmark. |
| `src/session/` | Append-only JSONL session log, redacted. |

## Getting started

Prerequisites: [Bun](https://bun.sh/) ≥ 1.3.10 and an OpenAI API key.

```bash
git clone https://github.com/Aryansinghparmar/codeLoop.git
cd codeLoop
bun install --frozen-lockfile
cp .env.example .env      # then set OPENAI_API_KEY; never commit .env
bun run start             # interactive session in the current folder
```

| Command | What it does | Needs a key? |
|---|---|---|
| `bun test` | Unit and integration tests | No |
| `bun run typecheck` | Strict TypeScript check | No |
| `bun run eval` | 12 scripted tasks with a fake process runner (checks the harness, not the model) | No |
| `bun run eval:context` | Compaction benchmark on a synthetic 38-message history | No |
| `bun run eval:summarize --dir <folder>` | Recompute pass rate, latency, trace stats and bounds from stored results | No |
| `bun run eval:live` / `eval:repeat` | Live tasks against the API (writes to a new timestamped folder) | Yes, and `CODELOOP_LIVE_CONFIRM=yes` |

## Measured results

Both campaigns use the same 10 small live tasks × 3 repeats. Raw traces are in [`evals/published/`](evals/published/), and every number below can be recomputed offline with `eval:summarize`.

| | cv-baseline | after hardening |
|---|---|---|
| Grading | file substring checks | file checks + grader runs `bun test` (with a hidden test) |
| Pass rate | 30/30 | 29/30 |
| Median / P95 latency | 11.47 s / 15.23 s | 9.64 s / 34.59 s |
| Agent's own test run passed | 7/30 runs | 29/30 runs |
| Failed tool calls | 148/233 | 61/162 |

Context benchmark (`eval:context`): 74,151 → 20,632 estimated tokens (−72.18%) on a synthetic 38-message history, using the window stage.

Read [`evals/published/README.md`](evals/published/README.md) before quoting these. It covers correlated repeats, nearest-rank P95, the small task set and estimated costs.

## Safety model, and its limits

What it does:
- **Path containment.** Every file path is resolved with `realpathSync.native` (so symlinks and junctions are followed) and must stay inside the project root. `.env`, `.git`, keys and system paths are always denied, and NTFS alternate streams are rejected.
- **Three permission tiers.**
  - **allow:** read-only commands (`git status/diff/log`, plain `ls`) and edits inside `src/` and `tests/`.
  - **confirm:** anything that runs project code (`bun test`, `bun run`, `node`), chaining, redirection, and edits to config files or existing files elsewhere.
  - **deny:** destructive commands, environment dumps, and any reference to protected files.
  - With no approver available, confirm means rejected (fail closed).
- **Process hygiene.** Shell children get an allowlisted environment with API keys removed. Timeouts kill the whole process tree.
- **Output hygiene.** Tool results and session logs are redacted for common secret formats.

What it is not: **a sandbox.** Shell classification is regex-based and can be evaded. Code you approve runs with your user's permissions. Token counts in compaction are `chars/4` estimates. For untrusted repositories, run it in a container or VM.

## Limitations and next steps
- No read-only search tool (grep/glob/list), so code search goes through shell and often needs approval. This is the main cause of the latency tail.
- Loop detection only catches identical repeated *failures*, not cycles of successful calls.
- No streaming output. Compaction does not summarise with an LLM.
- The eval tasks are small and correlated. A larger multi-file task set with pass@k is the next step for measurement.

See [`CHANGELOG.md`](CHANGELOG.md) for what changed since `cv-baseline`, why, and how each problem was found.

## License

MIT, see [LICENSE](LICENSE).
