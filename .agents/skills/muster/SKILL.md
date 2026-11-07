---
name: muster
description: Use Muster to report agent status, ask the human for decisions, post result cards, and track runbooks — via the muster CLI, or the MCP tools when the server is available.
license: MIT
---

# Muster

Muster is the project's coordination layer. A person watches a Herdr window;
you report through Muster so they don't have to read your terminal.

The CLI is the reference surface: every operation an MCP tool does exists as
a command, and both print the same objects. This skill is CLI-first. If the
Muster MCP server is connected, use the equivalent tools instead — see
[mcp.md](./mcp.md).

## Workflow

1. **Start:** `muster whoami` — resolves the project, opens (or refreshes)
   your run, and shows the cards already waiting for you.
2. **Work:** `muster status working "…"` with a concrete one-line summary.
   `blocked` the moment you cannot continue on your own.
3. **Ask, don't guess:** `muster ask --question "…" --choice id:label …`
   for decisions, approvals, or missing context. If it returns `pending`,
   the person hasn't answered — never invent an answer. Continue other work
   and re-check with `muster card show <id>` later.
4. **Post:** `muster card post` for anything a person must see (result,
   risk, failing check, decision record). Always set `--dedupe` on retries.
5. **Runbooks:** `muster runbook show`, then `muster runbook step <n>
   doing|done|blocked --note "…"`. Never mark done unless the command ran.
6. **Finish:** `muster status done|failed "…"` and resolve the cards you
   opened. Don't leave finished work in the attention list.

## Finding the CLI

The installer writes the exact command to
`%USERPROFILE%\.config\herdr-app\muster.json`:

```powershell
Get-Content "$env:USERPROFILE\.config\herdr-app\muster.json"
# { "command": "bun", "prefix": ["…\service\src\cli.ts"], … }
# or, with -Compile: { "command": "…\bin\muster.exe", "prefix": [] }
```

Run `bun <prefix> whoami` (or the exe). If the file is missing, fall back to
`bun …\service\src\cli.ts whoami` under the app home. Add `--json` for
machine-readable output.

## Details

- Full command reference, flags, and examples: [cli.md](./cli.md)
- MCP tools and client setup: [mcp.md](./mcp.md)
- Card lifecycle, project identity, runbooks, artifacts, style: [cards.md](./cards.md)

## Rules

- Titles are short and concrete. Bodies may be markdown.
- Say what changed, what's uncertain, and what the person should do next.
- Never put secrets, tokens, or private keys in cards, notes, or events.
- `pending` is not a yes, and an empty list is not proof nothing is waiting —
  read `whoami` / `card list` afresh at meaningful checkpoints.
