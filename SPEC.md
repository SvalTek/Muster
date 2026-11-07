# Muster specification

Status: v0.1.0. This document describes what Muster is, what it stores, and the
contracts every surface (CLI, MCP, Herdr mod) shares.

## 1. Purpose

Muster is a project-scoped attention layer for coding agents. An agent works in
a repository and reports through Muster; a person watches a Herdr window and
sees only what needs them.

Three rules shape the design:

1. **Projects are durable, runs are ephemeral, cards are durable.** A project
   keeps its cards and runbook forever. A run is one agent session and ends.
2. **The database is the single source of truth.** The CLI, the MCP server and
   the Herdr views all read and write the same SQLite file. The window never
   invents state; it rereads a snapshot.
3. **A missing answer is not an answer.** If a question is still `pending`, the
   agent must not guess. It continues other work or leaves the question open.

Muster is standalone. It shares Kanso's visual language and borrows cockpit's
card and runbook ideas, but has its own service, store, themes and mod. It does
not import or depend on either.

Non-goals for v1: hosted or shared stores, inbox/mail integrations, CI status,
monitors, notifications outside Herdr, and any Unix-only assumption.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **Project** | A repository or folder Muster recognizes by key. Owns cards, runs, artifacts and runbooks. |
| **Run** | One live agent session in a project. Heartbeats, has a state and a one-line summary, ends on `done`/`failed`. |
| **Card** | A durable thing a person must see or decide: question, approval, report, result, progress. |
| **Action** | A named button on a card. Pressing it answers the card. |
| **Answer** | The chosen action, free text, a note, and who answered. |
| **Artifact** | A file path or `http(s)` URL attached to a card or a run. The file is not copied. |
| **Event** | An append-only fact (`card.posted`, `run.state`, …) used by the activity feed. |
| **Runbook** | Ordered steps imported from markdown. Step state lives in the database. |
| **Marker** | An optional `.muster.json` that pins a project's identity or points at a runbook. |

## 3. Project identity

### 3.1 Resolution order

Given a working folder, Muster resolves a project in this order:

1. **Marker `id`.** The first `.muster.json` walking up from the folder. If it
   has a non-empty `id`, that is the key.
2. **Canonical git remote.** `git remote get-url origin`, normalized (§3.3).
3. **Local key.** ``local:<slug(name)>-<shortHash(normalized common dir)>``.

The display name is:

1. marker `name`;
2. the last segment of the canonical remote path;
3. a manifest name (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`);
4. the repository folder (or working folder) name.

`source` records which rule won: `marker`, `git`, `manifest` or `folder`. A
marker with only a name or color does not change the key; `source` stays `git`
or `folder`.

### 3.2 Root and marker

- The project root is the git top level when there is one, otherwise the folder
  containing the nearest marker, otherwise the working folder.
- The marker search is case-insensitive on Windows and walks to the drive root.
- A malformed marker is treated as `{}` so inference still works; it never makes
  every command fail.
- `muster init` writes `.muster.json` at the root, preserving existing keys.
  `--force` replaces the marker contents.

```json
{
  "id": "gh:acme/api",
  "name": "Acme API",
  "color": "#8fa58a",
  "runbook": "docs/release.md",
  "links": [{ "label": "Staging", "url": "https://staging.acme.example" }]
}
```

`runbook` is relative to the project root. `links` is carried in the marker for
future UI; v1 does not render it.

### 3.3 Canonical remotes

SSH, HTTPS and scp-like remotes normalize to one key:

| Remote | Key |
| --- | --- |
| `git@github.com:acme/api.git` | `gh:acme/api` |
| `https://github.com/acme/api` | `gh:acme/api` |
| `ssh://git@gitlab.com/acme/api.git` | `gl:acme/api` |
| `https://git.example.com/Team/Api.git` | `git.example.com:Team/Api` |

Known hosts get short aliases: `github.com` → `gh`, `gitlab.com` → `gl`,
`bitbucket.org` → `bb`, `codeberg.org` → `cb`, `git.sr.ht` → `srht`. Known-host
paths are lowercased; other hosts keep path case. A trailing `.git` and
trailing slashes are removed. `file://` remotes are ignored. Ports are kept
unless they are 22, 80 or 443.

Git worktrees share the **main repository's** key because resolution uses
`--git-common-dir`, not the worktree's own `.git` file. Branch and worktree
flags are recorded on the run, not on the project key.

### 3.4 Deterministic values

- Project ids are `prj_<18 hex>`; card ids `card_…`, run ids `run_…`, artifact
  ids `art_…`.
- With no marker color, a project's color is chosen deterministically from
  eight muted tones by hashing the key (FNV-1a, base 36).
- Projects are upserted by key. Name, color, root, remote, marker, source and
  `seen_at` refresh on every resolution; `created_at` stays.

## 4. Data model

One SQLite database, opened in WAL mode with `foreign_keys = ON` and a 5-second
busy timeout. `PRAGMA user_version` is the schema version (currently `1`).

### 4.1 `projects`

`id`, `key` (unique), `name`, `color`, `root`, `remote`, `marker` (raw JSON),
`source`, `created_at`, `seen_at`.

### 4.2 `runs`

`id`, `project_id`, `run_key`, `agent`, `terminal`, `cwd`, `branch`, `worktree`,
`machine`, `state`, `summary`, `started_at`, `heartbeat_at`, `ended_at`.

- A run is created lazily by any operation that needs agent context
  (`whoami`, `status`, posting a card, logging an event, adding an artifact).
- `run_key` is derived from identity, so repeated calls reuse one live run:
  - terminal handle: `<projectId>|terminal:<terminal>`
  - else agent: `<projectId>|agent:<agent>|<cwd>`
  - else folder: `<projectId>|cwd:<cwd>`
- `ensureRun` reuses the open row with the same key, refreshes metadata and the
  heartbeat.
- `state` is one of `working`, `blocked`, `waiting`, `done`, `failed`, `idle`.
  `done` and `failed` set `ended_at`; the next call in that context starts a new
  run.
- A unique partial index allows only one open run per `run_key`.
- `machine` is `MUSTER_MACHINE` or the host name.
- Stale runs are not reaped in v1. A run stays live until it reports
  `done`/`failed`; the UI shows its heartbeat age.

### 4.3 `cards`

`id`, `project_id`, `run_id`, `kind`, `title`, `body`, `severity`, `state`,
`actions_json`, `refs_json`, `answer_json`, `dedupe_key`, `version`,
`created_at`, `updated_at`, `answered_at`.

Kinds: `question`, `approval`, `report`, `result`, `progress`.
Severities: `info`, `attention`, `blocked`, `success`.
States: `open`, `claimed`, `answered`, `resolved`, `dismissed`, `expired`.

- Defaults: kind `report`; severity `attention` for `question`/`approval`,
  otherwise `info`.
- Titles are capped at 300 characters; bodies at 20,000. An empty body is
  stored as `""`.
- Actions are capped at 12. Each has `id` (80), `label` (160), `style`
  (`primary`/`secondary`/`danger`, default `secondary`), `confirm` (boolean or
  a prompt string) and optional opaque `payload`.
- `refs` is free-form JSON: file, branch, ticket, URL, anything short. The UI
  shows each key/value as a chip.
- `version` increments on every state change and is used for optimistic
  concurrency (`answer --version N` rejects with `card_changed` when stale).

### 4.4 Card lifecycle

```
open ──claim──▶ claimed ──answer──▶ answered ──resolve──▶ resolved
  │                │                   │
  └────answer──────┴───────────────────┘
  └────dismiss───▶ dismissed          (from any non-closed state)
```

- `claim` moves `open` to `claimed`; claiming anything else is a no-op that
  returns the card.
- `answer` records an action id, text, note and actor, sets `answered_at` and
  moves to `answered`. Answered cards may be revised until resolved.
- `resolve` closes the card, keeps the answer and stamps `answered_at` if it
  was missing.
- `dismiss` closes the card without an answer.
- `expired` is a valid stored state and is handled by the UI and waiters, but
  v1 has no expiry job; nothing sets it automatically.
- Answering a closed card returns `card_closed`. An unknown card returns
  `card_not_found`.

### 4.5 Dedupe

`dedupe_key` (≤200 chars) makes retries idempotent. Posting an active card with
the same project + dedupe key returns the existing card with `deduped: true`.
A partial unique index enforces this for states `open`, `claimed` and
`answered`. Once a card is resolved or dismissed, the key is free again.

### 4.6 Attention order

`listCards` orders by:

1. severity: `blocked`, `attention`, `info`, others;
2. state: `open`, `claimed`, `answered`, others;
3. `updated_at` descending.

The board's **needs** count includes open/claimed cards whose kind is
`question`/`approval` or whose severity is `blocked`/`attention`. A project's
next move is, in order: that kind of card (`answer`), the newest blocked run
(`unblock`), any other open card (`review`), else `clear`.

### 4.7 `events`

`id` (autoincrement), `at`, `kind`, `project_id`, `run_id`, `card_id`,
`payload` JSON. Append-only. Built-in kinds: `run.state`, `card.posted`,
`card.claimed`, `card.answered`, `card.resolved`, `card.dismissed`,
`artifact.added`, `runbook.imported`, `runbook.step`, `runbook.error`. Agents
may append their own kinds with `muster_log_event`.

### 4.8 `artifacts`

`id`, `project_id`, `run_id`, `card_id`, `kind` (`file`/`url`), `title`, `path`,
`url`, `mime`, `created_at`.

- A URL must be `http` or `https`.
- A file path must exist and be a file. Relative paths resolve against the
  process working folder, not the project root.
- The title defaults to the URL's last path segment or the file name.
- The database stores the pointer; the file is never copied or uploaded.

### 4.9 `runbooks` and `runbook_steps`

`runbooks`: `project_id`, `slug`, `title`, `source_path`, `updated_at`.
`runbook_steps`: `project_id`, `slug`, `n`, `title`, `command`, `state`,
`owner_run`, `note`, `updated_at`.

Markdown rules:

- The first `# Heading` is the runbook title.
- Every `## Heading` is a step, numbered from 1.
- List numbering, `[ ]`/`[x]` prefixes and HTML comments are stripped from the
  heading.
- A `<!-- muster: command="…" -->` comment in the heading sets the command.
- Otherwise the first fenced code block under the step is its command.
- Re-importing updates titles and commands but **keeps step state**, owner and
  note. Steps beyond the new length are deleted.
- The slug defaults to the file name without `.md`, lowercased and
  dash-separated.

Step states: `todo`, `doing`, `done`, `blocked`, `skipped`.

## 5. Snapshot and stats

`muster snapshot --json` is the only thing the Herdr views read. Shape:

```json
{
  "at": "2026-11-07T10:00:00.000Z",
  "version": 1,
  "musterVersion": "0.1.0",
  "home": "C:\\Users\\you\\AppData\\Local\\Muster",
  "db": "C:\\Users\\you\\AppData\\Local\\Muster\\muster.db",
  "board": [],
  "cards": [],
  "runs": [],
  "artifacts": [],
  "events": [],
  "stats": {},
  "runbooks": []
}
```

Limits: 60 cards (including closed), 25 recent runs, 50 artifacts, 40 events.
The snapshot auto-imports marker runbooks that have no rows yet.

A board row carries `id`, `key`, `name`, `color`, `root`, `source`, `branch`,
`runbook` (from the marker), `liveRuns`, `openCards`, `needs`,
`answeredWindow`, `lastAt`, and `next`.

Stats (`--days N`, clamped 1–90, default 14) contain:

- totals: projects, live/total runs, working/blocked agents, open cards, cards
  that need a person, answered cards;
- counts by card state, kind and severity;
- response time: answered count, median and p90 seconds (time from posting to
  `answered_at`, only for answers inside the window);
- a day-by-day activity series for the whole window, including zero days;
- a project table with open, needs, live runs, answered and last event time.

## 6. CLI

The CLI is the reference surface. Every command accepts `--json`.

```
muster init [--name N] [--id ID] [--color #hex] [--runbook path] [--force]
muster resolve [path] [--json]
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
muster answer <id> [...]                      # shorthand for card answer
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
muster projects
muster runs [--project KEY] [--all]
muster doctor
muster mcp
muster version
```

Global flags: `--json`, `--path DIR`, `--project KEY`, `--db FILE`, `--agent
NAME`, `--terminal ID`. `--db` sets `MUSTER_DB` before the database is opened.
`MUSTER_HOME`, `MUSTER_DB`, `MUSTER_MACHINE`, `MUSTER_PATH`, `MUSTER_AGENT` and
`MUSTER_TERMINAL` are environment equivalents.

Errors print `muster: <message>` to stderr and exit 1; with `--json` they print
`{"error":{"code":"…","message":"…"}}` to stdout. Success output is human text,
or JSON with `--json`.

## 7. MCP

`muster mcp` serves newline-delimited JSON-RPC 2.0 over stdin/stdout. Nothing
except protocol messages is written to stdout; logs go to stderr.

- Server name: `muster`. Supports MCP `2025-06-18`, `2025-03-26` and
  `2024-11-05`; an unknown requested version falls back to the newest.
- Advertises tools and the `muster://skill` resource and section template, with
  an empty prompts list. Implements `initialize`, `ping`, tool and resource calls,
  `logging/setLevel`, and the usual notifications.
- Requests are processed in order because `ask_human` and `await_card` may
  block for up to 120 seconds.
- The `initialize` result carries `MUSTER_INSTRUCTIONS` (see
  `app/instructions.ts` and `docs/agents-snippet.md`).
- Run identity prefers explicit tool parameters, then `MUSTER_PATH` /
  `MUSTER_AGENT` / `MUSTER_CLIENT`, `MUSTER_TERMINAL`, `HERDR_TERMINAL_ID`, then
  the server's working folder.

Tools:

| Tool | Required | Does |
| --- | --- | --- |
| `muster_whoami` | — | Resolve the project, start/refresh the run, return waiting cards, next move and instructions. |
| `muster_report_status` | `state`, `summary` | Set run state; `done`/`failed` end the run. |
| `muster_post_card` | `title` | Post a card with optional body, kind, severity, actions, refs, dedupe key. |
| `muster_ask_human` | `question` | Post a question card and wait `timeout_s` (0–120, default 25). |
| `muster_await_card` | `card_id` | Wait again on an existing card; never creates one. |
| `muster_list_cards` | — | List cards, optionally by project key, states, kind, limit. |
| `muster_resolve_card` | `card_id` | Resolve a card with an optional resolution and actor. |
| `muster_add_artifact` | `path` or `url` | Attach a file or link to a card or the current run. |
| `muster_runbook_get` | — | Read runbooks and step state; imports the marker runbook when empty. |
| `muster_runbook_import` | `file` | Import markdown; re-import keeps step state. |
| `muster_runbook_step` | `slug`, `n`, `state` | Move one step, with an optional note. |
| `muster_log_event` | `kind` | Append a progress event with a small JSON payload. |

`ask_human` and `await_card` return `{state, card, answer?, hint?}`. `state` is
`answered`, `pending`, `dismissed` or `expired`. A `pending` result includes the
instruction not to invent an answer.

## 8. Herdr integration

### 8.1 Files installed

```
<app home>/themes/muster.json          dark theme
<app home>/themes/muster-day.json      light theme
<app home>/layouts/muster.json         the layout
<app home>/mods/muster/                the mod (JS, mod.json, icons)
<app home>/muster/                     the bundled CLI or standalone executable
<app home>/muster.json                 the mod's install record
<data home>/muster.db                  the SQLite database
```

`<data home>` is `%LOCALAPPDATA%\Muster` by default (or `XDG_DATA_HOME/muster`
elsewhere), overridable with `MUSTER_HOME`.

### 8.2 The install record

The mod cannot read environment variables, so the installer writes:

```json
{
  "command": "bun",
  "prefix": ["C:\\Users\\you\\.config\\herdr-app\\muster\\cli.js"],
  "db": "C:\\Users\\you\\AppData\\Local\\Muster\\muster.db",
  "version": "0.1.0"
}
```

`state.js` reads it from `appHome()/muster.json`. If it is missing it falls back
to `bun <app home>/muster/cli.js`. `db` is prepended as `--db <path>` so
the window and the CLI always agree, even when `LOCALAPPDATA` differs. With
the standalone binary, `command` points at the copy in `<app home>/muster/`
and `prefix` is empty.

The mod runs the CLI through `exec(command, [...prefix, ...args])`; it never
uses `sh -c` or environment injection.

### 8.3 The layout

- Sidebar: brand (46 px), project list, footer (74 px).
- Topbar: Herdr tabs plus the Muster bell (52 px).
- Center stack with ids `board`, `cards`, `runbook`, `stats`, `work`. `work` is
  the normal Herdr panes with a Muster pane header.
- Status row (28 px) under the center stack.

Themes are selected by the layout: `muster-day` in light mode, `muster` in
dark. Both are flat warm neutrals with hairline borders and a muted sage accent.

### 8.4 Views and state

One mod (`mods/muster`) exposes one view per `props.app`: `brand`, `sidebar`,
`footer`, `bell`, `board`, `cards`, `runbook`, `stats`, `status`, `pane`. All
files are flat in the mod folder and import each other with `./state.js`,
`./kit.js`, `./helpers.js` (no `../`), which is what Herdr's module loader
expects.

Shared UI state uses `shared()`:

- `muster.project` — selected project key;
- `muster.card` — selected card id;
- `muster.view` — last center view.

Every mounted view subscribes to one global snapshot store. It refreshes on
mount, every 3 seconds, after a button press, and on `Ctrl+Shift+R`. The CLI is
one process per call; concurrent refreshes are deduped. Nothing is optimistic:
on failure the last good snapshot stays and the footer shows the error.

### 8.5 Keys

`keys.json` contributes a `layout:muster` section:

| Key | Command |
| --- | --- |
| `ctrl-shift-1` | `muster.go:board` |
| `ctrl-shift-2` | `muster.go:cards` |
| `ctrl-shift-3` | `muster.go:runbook` |
| `ctrl-shift-4` | `muster.go:stats` |
| `ctrl-shift-5` | `muster.go:work` |
| `ctrl-shift-m` | `muster.next` |
| `ctrl-shift-r` | `muster.refresh` |

Commands are broadcast to every mounted view; each copy drains the queue with
`nextCommand()`. Only the `brand` copy acts on `muster.*`.

### 8.6 Presses

- Answer, resolve, dismiss and runbook step changes call the CLI, then reread
  the snapshot.
- Dangerous presses arm first: **Dismiss** and dangerous choices require a
  second press within four seconds. Any other style arms the same way when a
  card action has `confirm`.
- The cards view has four filters — Needs, Open, Answered, All — scoped to the
  selected project.
- Card bodies render as selectable markdown. Artifacts open in the system's
  default app (`start` on Windows, `open` on macOS, `xdg-open` elsewhere).

## 9. Windows-first behavior

- No Unix sockets, `sh -c`, `lsof`, `sips` or shell pipelines.
- Paths use Windows separators in display and are compared case-insensitively
  for project membership.
- Git is invoked with `spawnSync(..., { windowsHide: true, timeout: 10s })`.
- `.muster.json` discovery walks from a drive folder to its root.
- `muster install` merges keys with a timestamped
  backup, and leaves existing bindings alone.
- The service also runs on macOS and Linux; `%LOCALAPPDATA%` becomes
  `XDG_DATA_HOME`.

## 10. Failure behavior

| Situation | Result |
| --- | --- |
| Git missing | Folder/manifest identity; no branch or worktree. |
| Broken marker JSON | Marker treated as `{}`; inference continues. |
| Marker runbook missing | Runbook list stays empty; `runbook.error` event on auto-import; explicit import returns `runbook_missing`. |
| Database busy | Waits up to 5 seconds, then fails the call. |
| CLI fails in the window | Footer shows `Muster service unreachable` with the error; snapshot stays at the last good value. |
| MCP tool error | `isError: true` with `{"error":{"code","message"}}` content. |
| `ask`/`await` timeout | Returns `pending`; no invented answer. |
| Wrong answer version | `card_changed`; reread the card. |

## 11. Privacy

Everything is local. Muster makes no network calls and has no telemetry. An
artifact stores a path or URL; it never uploads a file. Cards, notes and events
must not contain secrets, tokens or private keys.

## 12. Deferred

- Inbox and mail integrations, CI status, monitors.
- Remote or shared databases and authentication.
- Automatic run expiry and card expiry (the `expired` state exists but nothing
  sets it).
- Rendering marker `links`.
- Notifications outside Herdr.
