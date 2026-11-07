# Muster cards, project identity, and style

Projects are durable, runs are ephemeral, cards are durable. This file
covers the model behind the commands in [cli.md](./cli.md) and the tools in
[mcp.md](./mcp.md).

## Project identity

A project is resolved from the working folder, in this order:

1. Marker `id` — first `.muster.json` walking up from the folder.
2. Canonical git remote — normalized so `git@github.com:acme/api.git` and
   `https://github.com/acme/api` are the same key (`gh:acme/api`).
3. Local key — folder name plus a path hash.

Display name: marker `name` → remote last segment → manifest name → folder
name. The project root is the git top level, or the marker folder, or the
working folder. A marker without an `id` doesn't change the key, only the
name/color. `muster init` writes `.muster.json` to pin identity:

```json
{
  "id": "gh:acme/api",
  "name": "Acme API",
  "color": "#8fa58a",
  "runbook": "docs/release.md"
}
```

Git worktrees share the main repo's key; branch and worktree are recorded on
the run, not on the project. A malformed marker is ignored (treated as `{}`)
so inference still works. Run `muster resolve` to see what the folder maps to
before debugging a wrong-looking project.

## Runs

Any operation needing agent context (`whoami`, `status`, posting a card)
creates or refreshes a run. Repeated calls in the same context reuse one live
run (keyed by terminal handle, then agent + folder, then folder). `done` and
`failed` end the run; the next call starts a new one. Report `working` when
you begin, `blocked` as soon as you cannot continue on your own, and
`done`/`failed` with what actually happened.

## Cards

Kinds: `question`, `approval`, `report`, `result`, `progress`.
Severities: `info`, `attention`, `blocked`, `success`.
States: `open` → `claimed` → `answered` → `resolved`, plus `dismissed` and
`expired`.

- Defaults: kind `report`; severity `attention` for question/approval, else
  `info`. Titles ≤ 300 chars, bodies ≤ 20,000.
- Actions (≤ 12): `id`, `label`, `style` (`primary`/`secondary`/`danger`),
  optional `confirm`, opaque `payload`. `refs` is free-form JSON via repeated
  `--ref k=v` (CLI) shown as chips.
- Lifecycle: `claim` takes `open` → `claimed`; `answer` records
  action/text/note and moves to `answered` (revisable until resolved);
  `resolve` closes it; `dismiss` puts it away without answering.
  `expired` exists as a state but nothing in v1 sets it automatically.
  Answering a closed card fails with `card_closed`; an unknown id with
  `card_not_found`.
- **Dedupe:** `dedupe_key` (≤ 200 chars) makes retries idempotent. Posting
  an active card with the same project + key returns the existing card
  (`deduped: true`). Once resolved or dismissed, the key is free again.
  Always set it on retries.
- **Attention order:** `blocked`, `attention`, `info`, rest — then `open`,
  `claimed`, `answered`, rest. The board's "needs" count is open/claimed
  cards that are question/approval or blocked/attention. The project's next
  move is: that kind of card (`answer`), the newest blocked run (`unblock`),
  any other open card (`review`), else `clear`.

## Runbooks

`##` headings in the imported markdown are steps, numbered from 1; the first
fenced code block under a step is its command. The first `# Heading` is the
title. Re-importing updates titles and commands but keeps step state. Steps:
`todo`, `doing`, `done`, `blocked`, `skipped`. Never mark a step done
unless its command really succeeded.

## Artifacts and events

- Artifacts are a file path (must exist and be a file) or an `http(s)` URL,
  attached to a card or the current run. The database stores the pointer;
  the file is never copied. Titles default to the file name or the last URL
  segment. CLI: `muster artifact add --file F | --url U [--card ID]`.
- Events are append-only facts (`card.posted`, `run.state`, …). Use `event
  log` / `muster_log_event` for progress worth seeing in the activity feed.
  `muster event list` / `muster snapshot --json` read them back.

## Style

- Titles are short and concrete. Bodies may be markdown.
- Say what changed, what is uncertain, and what the person should do next.
- Use `dedupe_key` when retrying so one report does not become five.
- Resolve the cards you opened; don't leave finished work in the attention
  list.
- Never put secrets, tokens, or private keys in cards, notes, or events.
