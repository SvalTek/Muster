# Muster CLI

`muster` is the one surface agents, scripts, and the Herdr mods use. Every
command accepts `--json` and prints the same objects the MCP tools return.
Run commands from the repository folder; the project is resolved from there
(see [cards.md](./cards.md#project-identity) for the resolution rules).

In this document `muster` means the globally installed CLI or a standalone
compiled executable (see [SKILL.md](./SKILL.md#finding-the-cli)).

## Global flags

| Flag | Effect |
| --- | --- |
| `--json` | Machine-readable output. |
| `--path DIR` | Resolve the project from `DIR` instead of the current folder. |
| `--project KEY` | Use a project key directly (skips resolution). |
| `--db FILE` | Use another database (or set `MUSTER_DB`). |
| `--agent NAME` | Record this agent name on the run (or set `MUSTER_AGENT`). |
| `--terminal ID` | Record this terminal handle on the run. |

Caution: `--path` always means the project folder. For an artifact file use
`--file` (or a positional), never `--path` — see
[artifacts](#artifacts).

In PowerShell, multi-line bodies are easiest with a single-quoted here-string
or a file, so quoting doesn't eat newlines.

## Commands

```text
muster install [herdr] [--app-home DIR] [--muster-home DIR] [--no-keys]
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
muster answer <id> [...]                     # shorthand for card answer
muster event log --kind K [--data JSON]
muster event list [--project KEY] [--card ID] [--limit N]
muster artifact add [--card ID] (--file F | --url U) [--title T] [--mime M]
muster artifact list [--card ID] [--project KEY]
muster runbook import <file.md> [--slug S] [--title T]
muster runbook list [--project KEY]
muster runbook show [--slug S] [--project KEY]
muster runbook step <n> <todo|doing|done|blocked|skipped> [--slug S] [--note N]
muster board [--days N]
muster stats [--days N]
muster snapshot [--days N]
muster skill [section or search]
muster projects
muster runs [--project KEY] [--all]
muster resolve [path] [--json]
muster init [--name N] [--id ID] [--color #hex] [--runbook path] [--force]
muster doctor
muster mcp
muster version
```

`muster skill` prints the main guide. Use `muster skill cli`, `muster skill
mcp`, `muster skill cards`, or `muster skill all` to read a guide. Other
arguments search all bundled guides case-insensitively and return matching
Markdown sections, for example `muster skill pending`.

Card kinds: `question`, `approval`, `report`, `result`, `progress`.
Severities: `info`, `attention`, `blocked`, `success` (defaults to
`attention` for question/approval, else `info`).
Card states: `open`, `claimed`, `answered`, `resolved`, `dismissed`,
`expired`.
Run states: `working`, `blocked`, `waiting`, `done`, `failed`, `idle`.

### Whoami / status

```text
muster whoami
muster status working "mapping the import graph"
muster status blocked "no network access to the registry"
muster status done "import graph mapped; migration applied"
```

`whoami` opens your run the first time and refreshes its heartbeat after.
`done` and `failed` end the run; the next command in this context starts a
new one. Always send a concrete summary — not "working on it".

### Ask and cards

```text
muster ask --question "Which branch should this land on?" \
  --choice main:main --choice release:release --timeout 0
muster card post --title "Migration applied" --body "- 3 tables" \
  --kind result --severity success --dedupe migration-2026-11-07
muster card post --title "Retry policy needs a decision" \
  --kind question --severity attention \
  --action backoff:"Exponential backoff":primary \
  --action fail:"Fail fast":danger --dedupe retry-policy
muster card list
muster card list --state open --limit 20
muster card show card_xxxx
muster card answer card_xxxx --action backoff
muster card claim card_xxxx
muster card resolve card_xxxx --resolution "backoff implemented and tested"
muster card dismiss card_xxxx
```

- `--choice id:label` / `--action id:label[:primary|danger]` — label may
  contain colons; only the last `primary`/`danger`/`secondary` segment is
  treated as the style.
- `--ref k=v` attaches free-form context (file, branch, ticket). Repeat it.
- `--timeout 0` on `ask` returns immediately with `pending` when nobody has
  answered yet. Default is 25s, max 120s. Re-check with `card show` or
  `card list --state open`. A `pending` is not a refusal and not a yes.
- `card answer --version N` is optimistic concurrency: a stale value fails
  with `card_changed` — re-read the card and retry.
- `claim` on a non-`open` card is a no-op that returns the card.

### Artifacts

Attach a file or link to a card or to your current run. File paths resolve
against the process working folder, not the project root — pass an absolute
path or run from the right folder.

```text
muster artifact add --file docs/plan.md --card card_xxxx
muster artifact add --url https://example.com/spec --title "Spec"
muster artifact add README.md
muster artifact list
muster artifact list --card card_xxxx
```

### Events, runbooks, board

```text
muster event log --kind milestone --data '{"step":"build"}'
muster event list --limit 20
muster runbook show
muster runbook step 2 doing
muster runbook step 2 done --note "tests passed"
muster runbook import docs/release.md --slug release
muster board
muster stats --days 14
muster snapshot --json
```

## Errors

Failures print `muster: <message>` to stderr and exit 1. With `--json` they
print `{"error":{"code":"…","message":"…"}}` to stdout. Common codes:
`card_not_found`, `card_closed`, `card_changed`, `runbook_missing`,
`artifact_missing`, `bad_url`, `usage`. Run `muster doctor` to check Bun,
Git, the data folder, the database, and project resolution.
