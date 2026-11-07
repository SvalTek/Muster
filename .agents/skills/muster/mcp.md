# Muster MCP

If the Muster MCP server is connected to your client, prefer its tools over
shelling out to the CLI. The server is the same executable — `muster mcp` —
and every tool returns the same objects as the corresponding CLI command
(see [cli.md](./cli.md)). This page is the fallback reference; the CLI
instructions remain canonical when MCP is unavailable.

## Connect

The server speaks newline-delimited JSON-RPC 2.0 over stdio. The installer
writes the exact paths to `%USERPROFILE%\.config\herdr-app\muster.json`
(`command` + `prefix`, or `<app home>\bin\muster.exe` with `-Compile`).

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

One server is enough for many repositories: every tool takes an optional
`path`, and `muster_whoami` defaults to the folder the client started the
server in. Prefer starting the server in the repository, or pass `path`
explicitly. Note the artifact tool uses `path`/`url` (MCP naming), while the
CLI uses `--file`/`--url` to avoid colliding with the global `--path`.

`initialize` returns Muster's policy as `instructions` — the same rules as
this skill. Reading it counts as having loaded the skill.

## Skill resource

Read `muster://skill` for the main guide, or use the resource template
`muster://skill{?section}`. Named sections `cli`, `mcp`, `cards`, and `all`
return guides; other values search across them, for example
`muster://skill?section=pending`.

## Tools

| Tool | Use it for |
| --- | --- |
| `muster_whoami` | Start of session: project, run, waiting cards, next move, instructions. |
| `muster_report_status` | `working` / `blocked` / `waiting` / `done` / `failed` / `idle` plus a summary. |
| `muster_post_card` | Durable report, result, risk, failing check, or decision record. |
| `muster_ask_human` | A decision, approval, or missing context, with 2–5 choices. |
| `muster_await_card` | Wait again on a question already posted. |
| `muster_list_cards` | Read the attention list, optionally by project or state. |
| `muster_resolve_card` | Close a card whose work is finished. |
| `muster_add_artifact` | Attach a file path or an `http(s)` link. |
| `muster_runbook_get` | Read the project's runbook and step state. |
| `muster_runbook_import` | Import a markdown runbook; re-import keeps progress. |
| `muster_runbook_step` | Move one step to `todo` / `doing` / `done` / `blocked` / `skipped`. |
| `muster_log_event` | Append a milestone to the activity feed. |

## Pending semantics

`muster_ask_human` waits 25 seconds by default; pass `timeout_s: 0` to return
immediately, or up to `120`. `muster_await_card` waits on an existing card and
never creates one.

Both return `{state, card, answer?, hint?}` where `state` is `answered`,
`pending`, `dismissed`, or `expired`. A `pending` result includes the
instruction not to invent an answer: continue other work, await again later,
or finish and leave the question open. A `pending` is not a refusal and not
a yes.

## Full setup guide

`docs/agents-snippet.md` in the Muster repo covers repo snippets
(`AGENTS.md` / `CLAUDE.md`), client config, the tool table, and a worked
example.
