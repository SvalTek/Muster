# Muster CLI

`muster` is the one surface agents, scripts, and the Herdr mods use. Every
command accepts `--json` and prints the same objects the MCP tools return.
Commands run from the repository folder; the project is resolved from there
(see [cards.md](./cards.md#project-identity) for the resolution rules).

## Global flags

| Flag | Effect |
| --- | --- |
| `--json` | Machine-readable output. |
| `--path DIR` | Resolve the project from `DIR` instead of the current folder. |
| `--project KEY` | Use a project key directly (skips resolution). |
| `--db FILE` | Use another database (or set `MUSTER_DB`). |
| `--agent NAME` | Record this agent name on the run (or set `MUSTER_AGENT`). |
| `--terminal ID` | Record this terminal handle on the run. |

In PowerShell, multi-line bodies are easiest with a here-string or a file, so
quoting doesn't eat newlines.

## Core commands

```text
muster whoami [--path DIR] [--agent A] [--terminal T]
muster status <working|blocked|waiting|done|failed|idle> [summary]
muster ask --question Q [--choice id:label]... [--timeout S] [--dedupe K]
muster card post --title T [--body B] [--kind K] [--severity S]
                  [--action id:label[:primary|danger]]... [--dedupe K] [--ref k=v]...
muster card list [--state open]... [--project KEY] [--all] [--limit N]
muster card show <id>
muster card answer <id> [--action ID] [--text T] [--note N] [--version N]
muster card claim <id>
muster card resolve <id> [--resolution R]
muster card dismiss <id>
muster event log --kind K [--data JSON]
muster event list [--project KEY] [--card ID] [--limit N]
muster runbook import <file.md> [--slug S] [--title T]
muster runbook list [--project KEY]
muster runbook show [--slug S] [--project KEY]
muster runbook step <n> <todo|doing|done|blocked|skipped> [--slug S] [--note N]
muster board [--days N]
muster stats [--days N]
muster snapshot [--days N]
muster projects
muster runs [--project KEY] [--all]
muster resolve [path] [--json]
muster init [--name N] [--id ID] [--color #hex] [--runbook path] [--force]
muster doctor
muster mcp
muster version
```

Card kinds: `question`, `approval`, `report`, `result`, `progress`.
Severities: `info`, `attention`, `blocked`, `success` (defaults to
`attention` for question/approval, else `info`).
Card states: `open`, `claimed`, `answered`, `resolved`, `dismissed`,
`expired`.
Run states: `working`, `blocked`, `waiting`, `done`, `failed`, `idle`.

## Typical flow

```text
muster whoami
muster status working "mapping the import graph"
muster ask --question "Which branch should this land on?" \
  --choice main:main --choice release:release --timeout 0
muster card list
muster card post --title "Migration applied" --body "- 3 tables" \
  --kind result --severity success --dedupe migration-2026-11-07
muster runbook show
muster runbook step 2 done --note "tests passed"
muster status done "import graph mapped; migration applied"
```

`--timeout 0` on `ask` returns immediately with `pending` when nobody has
answered yet. Re-check later with `muster card show <id>` (or `muster card
list --state open`). `ask` waits 25s by default, up to 120s. A `pending`
result is not a refusal and not a yes.

## Answering and advancing

- `muster card answer <id> --action <id>` records the chosen action (use a
  card's `--action id:label` at post time). `--text` adds free text,
  `--note` stays internal. `--version` is optimistic concurrency: a stale
  value fails with `card_changed` — re-read and retry.
- `muster card claim <id>` moves `open` to `claimed`; anything else is a
  no-op that returns the card.
- `muster card resolve <id> --resolution "…"` closes the card. Answered cards
  can be revised until resolved.
- `muster event log --kind milestone --data '{"step":"build"}'` appends a
  progress fact to the activity feed.

## Errors

Failures print `muster: <message>` to stderr and exit 1. With `--json` they
print `{"error":{"code":"…","message":"…"}}` to stdout. Common codes:
`card_not_found`, `card_closed`, `card_changed`, `runbook_missing`,
`artifact_missing`, `bad_url`. `muster doctor` checks Bun, Git, the data
folder, the database, and project resolution.
