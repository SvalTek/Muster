# Putting Muster in front of an agent

An agent only reports in if it is told to. Muster has three ways to tell it:
the MCP server's `initialize` instructions (automatic), a short block in the
repository's `AGENTS.md` or `CLAUDE.md`, and the CLI for agents that cannot use
MCP.

## The repository snippet

Paste this into `AGENTS.md` (Codex, Cursor, and others) or `CLAUDE.md` (Claude
Code), then commit it:

```markdown
## Muster

This project reports to Muster. If the Muster MCP server is available:
- Call `muster_whoami` at the start of a session.
- Call `muster_report_status` with `working`, then `blocked` / `done` / `failed` as things change.
- Use `muster_ask_human` for decisions you would otherwise guess; if it returns `pending`, call `muster_await_card` later.
- Resolve cards you opened before finishing.
```

That is the whole contract. The MCP server repeats it with more detail, so an
agent that calls `muster_whoami` also learns the working rules.

## Connect the MCP server

The server is the same executable as the CLI, with `mcp` after it. The
installer writes the exact paths to
`%USERPROFILE%\.config\herdr-app\muster.json`:

```powershell
Get-Content "$env:USERPROFILE\.config\herdr-app\muster.json"
```

The result looks like:

```json
{
  "command": "bun",
  "prefix": ["C:\\Users\\you\\.config\\herdr-app\\service\\src\\cli.ts"],
  "db": "C:\\Users\\you\\AppData\\Local\\Muster\\muster.db"
}
```

Claude Code:

```powershell
$cli = "$env:USERPROFILE\.config\herdr-app\service\src\cli.ts"
claude mcp add --transport stdio muster -- bun $cli mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.muster]
command = "bun"
args = ["C:\\Users\\you\\.config\\herdr-app\\service\\src\\cli.ts", "mcp"]
```

Any stdio MCP client:

```json
{
  "mcpServers": {
    "muster": {
      "command": "bun",
      "args": ["C:/Users/you/.config/herdr-app/service/src/cli.ts", "mcp"]
    }
  }
}
```

If the agent works in several repositories, one server is enough: every tool
takes an optional `path`, and `muster_whoami` defaults to the folder the client
started the server in. Prefer starting the server in the repository, or pass
`path` explicitly.

## What the agent gets

`initialize` returns Muster's policy as `instructions`; `muster_whoami` returns
it again alongside the project, the run and the cards already waiting. The
policy is short:

- Call `muster_whoami` first.
- Report `working`, `blocked`, `done` or `failed` with a concrete one-line
  summary.
- Ask instead of guessing; if the answer is `pending`, wait later or leave the
  question open.
- Post a card for anything a person must see; use `dedupe_key` on retries.
- Resolve cards you opened; never claim a runbook step succeeded unless its
  command did.
- No secrets, tokens or private keys in cards, notes or events.

## Tools

| Tool | Use it for |
| --- | --- |
| `muster_whoami` | Start of session: project, run, waiting cards, next move. |
| `muster_report_status` | `working` / `blocked` / `waiting` / `done` / `failed` / `idle` plus a summary. |
| `muster_post_card` | Durable report, result, risk, failing check or decision record. |
| `muster_ask_human` | A decision, approval or missing context, with 2–5 choices. |
| `muster_await_card` | Wait again on a question already posted. |
| `muster_list_cards` | Read the attention list, optionally by project or state. |
| `muster_resolve_card` | Close a card whose work is finished. |
| `muster_add_artifact` | Attach a file path or an `http(s)` link. |
| `muster_runbook_get` | Read the project's runbook and step state. |
| `muster_runbook_import` | Import a markdown runbook; re-import keeps progress. |
| `muster_runbook_step` | Move one step to `todo` / `doing` / `done` / `blocked` / `skipped`. |
| `muster_log_event` | Append a milestone to the activity feed. |

`muster_ask_human` waits 25 seconds by default. Pass `timeout_s: 0` to return
immediately, or up to `120`. A `pending` answer is not a refusal and not a yes:
the agent must not proceed as if it were answered.

## When MCP is unavailable

Give the agent the CLI path and the same rules. Every operation is a command:

```text
muster whoami
muster status working "mapping the import graph"
muster ask --question "Which branch should this land on?" \
  --choice main:main --choice release:release --timeout 0
muster card post --title "Migration applied" --body "- 3 tables\n- 2 indexes" \
  --kind result --severity success --dedupe migration-2026-11-07
muster card list
muster runbook show
muster runbook step 2 done --note "tests passed"
```

`--json` gives machine-readable output. The command path written by the
installer is `<app home>/service/src/cli.ts` (or `<app home>/bin/muster.exe`
with `-Compile`).

## A working example

```text
agent:  muster_whoami
muster: project gh:acme/api, run working, 0 waiting cards

agent:  muster_report_status {state: "working", summary: "adding retry to the payments client"}
agent:  muster_post_card {
          title: "Retry policy needs a decision",
          kind: "question",
          severity: "attention",
          body: "The provider returns 429 without Retry-After. Options below.",
          actions: [
            {id: "backoff", label: "Exponential backoff", style: "primary"},
            {id: "fail", label: "Fail fast", style: "danger", confirm: "Fail every 429?"}
          ],
          dedupe_key: "retry-policy"
        }
muster: card card_… open

agent:  muster_await_card {card_id: "card_…", timeout_s: 60}
muster: state pending, hint "The person has not answered yet…"

agent:  …continues other work…

agent:  muster_await_card {card_id: "card_…", timeout_s: 120}
muster: state answered, answer {actionId: "backoff"}

agent:  muster_report_status {state: "done", summary: "payments retry uses exponential backoff; tests pass"}
agent:  muster_resolve_card {card_id: "card_…", resolution: "backoff implemented and tested"}
```

The card remains in the database after it is resolved, so the project keeps a
record of the decision without keeping it in the attention list.
