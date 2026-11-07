---
name: muster
description: Report agent work to Muster — start a run, post cards, ask the human, and track runbooks from the CLI or MCP.
license: MIT
---

# Muster

Muster is the project's coordination layer. A person watches a Herdr window;
you report through Muster so they don't have to read your terminal.

The CLI is the reference surface: every operation an MCP tool does exists as a
command, and both print the same objects. This skill focuses on the CLI. If
the Muster MCP server is connected, use the equivalent tools instead — see
[mcp.md](./mcp.md).

## When to use

- **Starting work:** run `muster whoami` — it resolves the project, opens your
  run, and shows the cards already waiting for you.
- **Reporting:** `muster status working|blocked|done|failed` with a concrete
  one-line summary whenever things change.
- **Asking:** `muster ask` for decisions, approvals, or anything you'd
  otherwise guess. A `pending` answer is not a yes — never invent one.
- **Posting:** `muster card post` for results, risks, failing checks, or
  decision records a person must see.
- **Runbooks:** `muster runbook show` / `muster runbook step` to follow and
  tick off the project's steps.
- **Reading:** `muster card list`, `muster board`, `muster stats`,
  `muster snapshot --json` for the attention list and activity.

## Quick start

```text
muster whoami
muster status working "adding retry to the payments client"
muster ask --question "Which retry policy?" \
  --choice backoff:"Exponential backoff" \
  --choice fail:"Fail fast" --timeout 0
muster card list
muster status done "retry uses backoff; tests pass"
```

Full command reference, flags, and examples: [cli.md](./cli.md).
MCP tools and client setup: [mcp.md](./mcp.md).
Card lifecycle, runbooks, artifacts, and style rules: [cards.md](./cards.md).

## Rules

- Titles are short and concrete. Bodies may be markdown.
- Use `--dedupe` on every retry so one report doesn't become five.
- Resolve the cards you opened before finishing; never mark a runbook step
  done unless its command really succeeded.
- Never put secrets, tokens, or private keys in cards, notes, or events.

## Finding the CLI

The installer writes the exact command to
`%USERPROFILE%\.config\herdr-app\muster.json` (`command` + `prefix`, or
`<app home>\bin\muster.exe` with `-Compile`). For example:

```powershell
Get-Content "$env:USERPROFILE\.config\herdr-app\muster.json"
```

Prefer the MCP tools when the server is connected (they return the same
objects with less shell quoting). Otherwise shell out to the CLI as shown in
[cli.md](./cli.md).
