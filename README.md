<p align="center">
  <h1 align="center">🔁 CodeLoop</h1>
  <p align="center">
    A safety-first terminal coding agent built in TypeScript on Bun.
    <br />
    Read → Edit → Run → Observe → Recover — in a self-correcting loop.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/status-v0.1.0-22c55e?style=flat-square" alt="Status" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

---

## ✨ What Is CodeLoop?

CodeLoop is an LLM-powered coding agent that runs in your terminal. Give it a task — *"fix this off-by-one"*, *"create a function and write a test"*, *"rename this symbol"* — and it drives an iterative **read → act → observe** loop until the job is done.

It reads files, makes precise edits, writes new files, and runs shell commands, recovering from errors automatically. The key difference from other agents: **safety is a first-class design constraint**, not an afterthought.

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│                   CLI Interface                  │
├──────────────────────────────────────────────────┤
│                   Agent Loop                     │
│         (read → act → observe → recover)         │
├───────────┬──────────┬───────────┬───────────────┤
│  Read     │  Write   │  Edit     │  Shell        │
│  Tool     │  Tool    │  Tool     │  Tool         │
├───────────┴──────────┴───────────┴───────────────┤
│              Safety & Permissions                │
│   path checks · deny rules · approval gates     │
├──────────────────────────────────────────────────┤
│            LLM Provider Interface                │
│        NVIDIA NIM  ·  OpenAI Responses API       │
└──────────────────────────────────────────────────┘
```

## 🚀 Features

| Category | Details |
|---|---|
| **Agent Loop** | Provider-neutral iterative loop with automatic error recovery |
| **LLM Backends** | NVIDIA NIM (development) · OpenAI Responses API (production) |
| **Tools** | File read, file write, exact edit, and shell execution |
| **Safety** | Project-root path checks, protected-path rules, command deny-lists, approval gates, process timeouts, output limits, step limits |
| **Observability** | JSONL session logs with automatic secret redaction |
| **Evaluation** | Offline deterministic test suite covering creation, repair, refactoring, recovery, and safety denial |
| **Optional Integrations** | MCP server support · LSP integration · Serper web search |
| **Testing** | Bun test runner with strict TypeScript checks |
| **Platform** | Windows-first path and command safety rules |

## 📦 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (latest)
- An API key for at least one supported LLM provider

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/CODE-LOOP.git
cd CODE-LOOP

# Install dependencies
bun install
```

### Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Add your provider API key to `.env`:
   ```env
   # For NVIDIA NIM (development)
   NVIDIA_API_KEY=your-key-here

   # For OpenAI (production measurements)
   OPENAI_API_KEY=your-key-here
   ```
3. **Never** commit `.env` — it is git-ignored by default.

## 🛠️ Usage

```bash
# Start the agent
bun run start

# Type-check the source
bun run typecheck

# Run unit and integration tests
bun test
```

### Evaluation Commands

```bash
bun run eval            # Run deterministic offline tasks
bun run eval:context    # Run the context-stress benchmark
bun run eval:live       # Run the live task subset (requires CODELOOP_LIVE_CONFIRM=yes)
bun run eval:repeat     # Repeat the live subset (default: 3 runs)
```

> **Note:** `eval:live` refuses to run unless `CODELOOP_LIVE_CONFIRM=yes` is set. It only runs safe, local coding tasks — no network, destructive, or secret-reading operations.

## 📁 Project Structure

```
CODE-LOOP/
├── src/
│   ├── agent/          # Core agent loop logic
│   ├── config/         # Configuration management
│   ├── context/        # Context window management
│   ├── evaluation/     # Eval CLI and task definitions
│   ├── infrastructure/ # Shared infra utilities
│   ├── llm/            # LLM provider adapters
│   ├── lsp/            # Language Server Protocol integration
│   ├── mcp/            # Model Context Protocol support
│   ├── permissions/    # Safety rules and permission checks
│   ├── session/        # Session logging and records
│   ├── shared/         # Shared types and helpers
│   ├── tools/          # Tool implementations
│   ├── ui/             # Terminal UI components
│   ├── web/            # Web search integration
│   └── main.ts         # Application entry point
├── tests/              # Unit, integration, and safety tests
├── .env.example        # Environment variable template
├── package.json
└── tsconfig.json
```

## 🔒 Safety Design

CodeLoop is **not** a complete operating-system sandbox. It applies multiple layers of protection:

- **Path checks** — operations are restricted to the project root
- **Protected paths** — sensitive files and directories are off-limits
- **Command deny-list** — dangerous shell commands are blocked
- **Approval gates** — commands outside the safe allow-list require user confirmation
- **Process timeouts** — runaway commands are automatically killed
- **Output & step limits** — prevents unbounded resource consumption

> The user always remains responsible for approving commands outside the safe allow-list.

## 🧪 Evaluation Suite

The offline evaluation suite verifies:

- ✅ File creation
- ✅ Bug repair
- ✅ Refactoring
- ✅ Recovery after failed reads
- ✅ Denial of protected file access and destructive commands

Each result record includes: success rate, latency, step count, tool calls, failed/recovered calls, context reductions, token usage, and estimated cost.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ using TypeScript and Bun
</p>
