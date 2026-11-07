// Generated from .agents/skills/muster/*.md. Do not edit by hand.
// Regenerate with: bun run scripts/build-skill.ts [--src DIR] [--out FILE]

export const SKILL_SECTIONS: Record<string, string> = {
  "skill": `---
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

1. **Start:** \`muster whoami\` — resolves the project, opens (or refreshes)
   your run, and shows the cards already waiting for you.
2. **Work:** \`muster status working "…"\` with a concrete one-line summary.
   \`blocked\` the moment you cannot continue on your own.
3. **Ask, don't guess:** \`muster ask --question "…" --choice id:label …\`
   for decisions, approvals, or missing context. If it returns \`pending\`,
   the person hasn't answered — never invent an answer. Continue other work
   and re-check with \`muster card show <id>\` later.
4. **Post:** \`muster card post\` for anything a person must see (result,
   risk, failing check, decision record). Always set \`--dedupe\` on retries.
5. **Runbooks:** \`muster runbook show\`, then \`muster runbook step <n>
   doing|done|blocked --note "…"\`. Never mark done unless the command ran.
6. **Finish:** \`muster status done|failed "…"\` and resolve the cards you
   opened. Don't leave finished work in the attention list.

## Finding the CLI

Install the CLI with \`bun install -g 'github:SvalTek/Muster#main'\`, then run
\`muster whoami\`. Use \`muster install\` to install the Herdr layout, theme and
mod. The Herdr install record is at \`%USERPROFILE%\\.config\\herdr-app\\muster.json\`.
Add \`--json\` for machine-readable output.

## Details

- Full command reference, flags, and examples: [cli.md](./cli.md)
- MCP tools and client setup: [mcp.md](./mcp.md)
- Card lifecycle, project identity, runbooks, artifacts, style: [cards.md](./cards.md)

## Rules

- Titles are short and concrete. Bodies may be markdown.
- Say what changed, what's uncertain, and what the person should do next.
- Never put secrets, tokens, or private keys in cards, notes, or events.
- \`pending\` is not a yes, and an empty list is not proof nothing is waiting —
  read \`whoami\` / \`card list\` afresh at meaningful checkpoints.
`,
  "cli": `# Muster CLI

\`muster\` is the one surface agents, scripts, and the Herdr mods use. Every
command accepts \`--json\` and prints the same objects the MCP tools return.
Run commands from the repository folder; the project is resolved from there
(see [cards.md](./cards.md#project-identity) for the resolution rules).

In this document \`muster\` means the globally installed CLI or a standalone
compiled executable (see [SKILL.md](./SKILL.md#finding-the-cli)).

## Global flags

| Flag | Effect |
| --- | --- |
| \`--json\` | Machine-readable output. |
| \`--path DIR\` | Resolve the project from \`DIR\` instead of the current folder. |
| \`--project KEY\` | Use a project key directly (skips resolution). |
| \`--db FILE\` | Use another database (or set \`MUSTER_DB\`). |
| \`--agent NAME\` | Record this agent name on the run (or set \`MUSTER_AGENT\`). |
| \`--terminal ID\` | Record this terminal handle on the run. |

Caution: \`--path\` always means the project folder. For an artifact file use
\`--file\` (or a positional), never \`--path\` — see
[artifacts](#artifacts).

In PowerShell, multi-line bodies are easiest with a single-quoted here-string
or a file, so quoting doesn't eat newlines.

## Commands

\`\`\`text
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
\`\`\`

\`muster skill\` prints the main guide. Use \`muster skill cli\`, \`muster skill
mcp\`, \`muster skill cards\`, or \`muster skill all\` to read a guide. Other
arguments search all bundled guides case-insensitively and return matching
Markdown sections, for example \`muster skill pending\`.

Card kinds: \`question\`, \`approval\`, \`report\`, \`result\`, \`progress\`.
Severities: \`info\`, \`attention\`, \`blocked\`, \`success\` (defaults to
\`attention\` for question/approval, else \`info\`).
Card states: \`open\`, \`claimed\`, \`answered\`, \`resolved\`, \`dismissed\`,
\`expired\`.
Run states: \`working\`, \`blocked\`, \`waiting\`, \`done\`, \`failed\`, \`idle\`.

### Whoami / status

\`\`\`text
muster whoami
muster status working "mapping the import graph"
muster status blocked "no network access to the registry"
muster status done "import graph mapped; migration applied"
\`\`\`

\`whoami\` opens your run the first time and refreshes its heartbeat after.
\`done\` and \`failed\` end the run; the next command in this context starts a
new one. Always send a concrete summary — not "working on it".

### Ask and cards

\`\`\`text
muster ask --question "Which branch should this land on?" \\
  --choice main:main --choice release:release --timeout 0
muster card post --title "Migration applied" --body "- 3 tables" \\
  --kind result --severity success --dedupe migration-2026-11-07
muster card post --title "Retry policy needs a decision" \\
  --kind question --severity attention \\
  --action backoff:"Exponential backoff":primary \\
  --action fail:"Fail fast":danger --dedupe retry-policy
muster card list
muster card list --state open --limit 20
muster card show card_xxxx
muster card answer card_xxxx --action backoff
muster card claim card_xxxx
muster card resolve card_xxxx --resolution "backoff implemented and tested"
muster card dismiss card_xxxx
\`\`\`

- \`--choice id:label\` / \`--action id:label[:primary|danger]\` — label may
  contain colons; only the last \`primary\`/\`danger\`/\`secondary\` segment is
  treated as the style.
- \`--ref k=v\` attaches free-form context (file, branch, ticket). Repeat it.
- \`--timeout 0\` on \`ask\` returns immediately with \`pending\` when nobody has
  answered yet. Default is 25s, max 120s. Re-check with \`card show\` or
  \`card list --state open\`. A \`pending\` is not a refusal and not a yes.
- \`card answer --version N\` is optimistic concurrency: a stale value fails
  with \`card_changed\` — re-read the card and retry.
- \`claim\` on a non-\`open\` card is a no-op that returns the card.

### Artifacts

Attach a file or link to a card or to your current run. File paths resolve
against the process working folder, not the project root — pass an absolute
path or run from the right folder.

\`\`\`text
muster artifact add --file docs/plan.md --card card_xxxx
muster artifact add --url https://example.com/spec --title "Spec"
muster artifact add README.md
muster artifact list
muster artifact list --card card_xxxx
\`\`\`

### Events, runbooks, board

\`\`\`text
muster event log --kind milestone --data '{"step":"build"}'
muster event list --limit 20
muster runbook show
muster runbook step 2 doing
muster runbook step 2 done --note "tests passed"
muster runbook import docs/release.md --slug release
muster board
muster stats --days 14
muster snapshot --json
\`\`\`

## Errors

Failures print \`muster: <message>\` to stderr and exit 1. With \`--json\` they
print \`{"error":{"code":"…","message":"…"}}\` to stdout. Common codes:
\`card_not_found\`, \`card_closed\`, \`card_changed\`, \`runbook_missing\`,
\`artifact_missing\`, \`bad_url\`, \`usage\`. Run \`muster doctor\` to check Bun,
Git, the data folder, the database, and project resolution.
`,
  "mcp": `# Muster MCP

If the Muster MCP server is connected to your client, prefer its tools over
shelling out to the CLI. The server is the same executable — \`muster mcp\` —
and every tool returns the same objects as the corresponding CLI command
(see [cli.md](./cli.md)). This page is the fallback reference; the CLI
instructions remain canonical when MCP is unavailable.

## Connect

The server speaks newline-delimited JSON-RPC 2.0 over stdio. Install the CLI
with Bun, then configure your client to run \`muster mcp\`.

Claude Code:

\`\`\`powershell
claude mcp add --transport stdio muster -- muster mcp
\`\`\`

Codex (\`~/.codex/config.toml\`):

\`\`\`toml
[mcp_servers.muster]
command = "muster"
args = ["mcp"]
\`\`\`

Any stdio MCP client:

\`\`\`json
{
  "mcpServers": {
    "muster": {
      "command": "muster",
      "args": ["mcp"]
    }
  }
}
\`\`\`

One server is enough for many repositories: every tool takes an optional
\`path\`, and \`muster_whoami\` defaults to the folder the client started the
server in. Prefer starting the server in the repository, or pass \`path\`
explicitly. Note the artifact tool uses \`path\`/\`url\` (MCP naming), while the
CLI uses \`--file\`/\`--url\` to avoid colliding with the global \`--path\`.

\`initialize\` returns Muster's policy as \`instructions\` — the same rules as
this skill. Reading it counts as having loaded the skill.

## Skill resource

Read \`muster://skill\` for the main guide, or use the resource template
\`muster://skill{?section}\`. Named sections \`cli\`, \`mcp\`, \`cards\`, and \`all\`
return guides; other values search across them, for example
\`muster://skill?section=pending\`.

## Tools

| Tool | Use it for |
| --- | --- |
| \`muster_whoami\` | Start of session: project, run, waiting cards, next move, instructions. |
| \`muster_report_status\` | \`working\` / \`blocked\` / \`waiting\` / \`done\` / \`failed\` / \`idle\` plus a summary. |
| \`muster_post_card\` | Durable report, result, risk, failing check, or decision record. |
| \`muster_ask_human\` | A decision, approval, or missing context, with 2–5 choices. |
| \`muster_await_card\` | Wait again on a question already posted. |
| \`muster_list_cards\` | Read the attention list, optionally by project or state. |
| \`muster_resolve_card\` | Close a card whose work is finished. |
| \`muster_add_artifact\` | Attach a file path or an \`http(s)\` link. |
| \`muster_runbook_get\` | Read the project's runbook and step state. |
| \`muster_runbook_import\` | Import a markdown runbook; re-import keeps progress. |
| \`muster_runbook_step\` | Move one step to \`todo\` / \`doing\` / \`done\` / \`blocked\` / \`skipped\`. |
| \`muster_log_event\` | Append a milestone to the activity feed. |

## Pending semantics

\`muster_ask_human\` waits 25 seconds by default; pass \`timeout_s: 0\` to return
immediately, or up to \`120\`. \`muster_await_card\` waits on an existing card and
never creates one.

Both return \`{state, card, answer?, hint?}\` where \`state\` is \`answered\`,
\`pending\`, \`dismissed\`, or \`expired\`. A \`pending\` result includes the
instruction not to invent an answer: continue other work, await again later,
or finish and leave the question open. A \`pending\` is not a refusal and not
a yes.

## Full setup guide

\`docs/agents-snippet.md\` in the Muster repo covers repo snippets
(\`AGENTS.md\` / \`CLAUDE.md\`), client config, the tool table, and a worked
example.
`,
  "cards": `# Muster cards, project identity, and style

Projects are durable, runs are ephemeral, cards are durable. This file
covers the model behind the commands in [cli.md](./cli.md) and the tools in
[mcp.md](./mcp.md).

## Project identity

A project is resolved from the working folder, in this order:

1. Marker \`id\` — first \`.muster.json\` walking up from the folder.
2. Canonical git remote — normalized so \`git@github.com:acme/api.git\` and
   \`https://github.com/acme/api\` are the same key (\`gh:acme/api\`).
3. Local key — folder name plus a path hash.

Display name: marker \`name\` → remote last segment → manifest name → folder
name. The project root is the git top level, or the marker folder, or the
working folder. A marker without an \`id\` doesn't change the key, only the
name/color. \`muster init\` writes \`.muster.json\` to pin identity:

\`\`\`json
{
  "id": "gh:acme/api",
  "name": "Acme API",
  "color": "#8fa58a",
  "runbook": "docs/release.md"
}
\`\`\`

Git worktrees share the main repo's key; branch and worktree are recorded on
the run, not on the project. A malformed marker is ignored (treated as \`{}\`)
so inference still works. Run \`muster resolve\` to see what the folder maps to
before debugging a wrong-looking project.

## Runs

Any operation needing agent context (\`whoami\`, \`status\`, posting a card)
creates or refreshes a run. Repeated calls in the same context reuse one live
run (keyed by terminal handle, then agent + folder, then folder). \`done\` and
\`failed\` end the run; the next call starts a new one. Report \`working\` when
you begin, \`blocked\` as soon as you cannot continue on your own, and
\`done\`/\`failed\` with what actually happened.

## Cards

Kinds: \`question\`, \`approval\`, \`report\`, \`result\`, \`progress\`.
Severities: \`info\`, \`attention\`, \`blocked\`, \`success\`.
States: \`open\` → \`claimed\` → \`answered\` → \`resolved\`, plus \`dismissed\` and
\`expired\`.

- Defaults: kind \`report\`; severity \`attention\` for question/approval, else
  \`info\`. Titles ≤ 300 chars, bodies ≤ 20,000.
- Actions (≤ 12): \`id\`, \`label\`, \`style\` (\`primary\`/\`secondary\`/\`danger\`),
  optional \`confirm\`, opaque \`payload\`. \`refs\` is free-form JSON via repeated
  \`--ref k=v\` (CLI) shown as chips.
- Lifecycle: \`claim\` takes \`open\` → \`claimed\`; \`answer\` records
  action/text/note and moves to \`answered\` (revisable until resolved);
  \`resolve\` closes it; \`dismiss\` puts it away without answering.
  \`expired\` exists as a state but nothing in v1 sets it automatically.
  Answering a closed card fails with \`card_closed\`; an unknown id with
  \`card_not_found\`.
- **Dedupe:** \`dedupe_key\` (≤ 200 chars) makes retries idempotent. Posting
  an active card with the same project + key returns the existing card
  (\`deduped: true\`). Once resolved or dismissed, the key is free again.
  Always set it on retries.
- **Attention order:** \`blocked\`, \`attention\`, \`info\`, rest — then \`open\`,
  \`claimed\`, \`answered\`, rest. The board's "needs" count is open/claimed
  cards that are question/approval or blocked/attention. The project's next
  move is: that kind of card (\`answer\`), the newest blocked run (\`unblock\`),
  any other open card (\`review\`), else \`clear\`.

## Runbooks

\`##\` headings in the imported markdown are steps, numbered from 1; the first
fenced code block under a step is its command. The first \`# Heading\` is the
title. Re-importing updates titles and commands but keeps step state. Steps:
\`todo\`, \`doing\`, \`done\`, \`blocked\`, \`skipped\`. Never mark a step done
unless its command really succeeded.

## Artifacts and events

- Artifacts are a file path (must exist and be a file) or an \`http(s)\` URL,
  attached to a card or the current run. The database stores the pointer;
  the file is never copied. Titles default to the file name or the last URL
  segment. CLI: \`muster artifact add --file F | --url U [--card ID]\`.
- Events are append-only facts (\`card.posted\`, \`run.state\`, …). Use \`event
  log\` / \`muster_log_event\` for progress worth seeing in the activity feed.
  \`muster event list\` / \`muster snapshot --json\` read them back.

## Style

- Titles are short and concrete. Bodies may be markdown.
- Say what changed, what is uncertain, and what the person should do next.
- Use \`dedupe_key\` when retrying so one report does not become five.
- Resolve the cards you opened; don't leave finished work in the attention
  list.
- Never put secrets, tokens, or private keys in cards, notes, or events.
`,
};

export const SKILL_SECTION_NAMES = ["skill","cli","mcp","cards"] as const;
