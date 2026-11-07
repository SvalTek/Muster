# Muster cards, runbooks, and style

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
working folder. `muster init` writes `.muster.json` to pin identity:

```json
{
  "id": "gh:acme/api",
  "name": "Acme API",
  "color": "#8fa58a",
  "runbook": "docs/release.md"
}
```

Git worktrees share the main repo's key; branch and worktree are recorded on
the run, not on the project.

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
- Actions (≤ 12) are `id`, `label`, `style` (`primary`/`secondary`/`danger`),
  optional `confirm`, and opaque `payload`. `refs` is free-form JSON
  (file, branch, ticket) shown as chips.
- Lifecycle: `claim` takes `open` → `claimed`; `answer` records action/text/
  note and moves to `answered` (revisable until resolved); `resolve` closes
  it; `dismiss` puts it away. Answering a closed card fails with
  `card_closed`.
- **Dedupe:** `dedupe_key` (≤ 200 chars) makes retries idempotent. Posting
  an active card with the same project + key returns the existing card. Once
  resolved or dismissed, the key is free again. Always set it on retries.
- **Attention order:** blocked first, then open/claimed questions and
  approvals, then everything else. The board's "needs" count is open/claimed
  cards that are question/approval or blocked/attention.

## Runbooks

`##` headings in the imported markdown are steps, numbered from 1; the first
fenced code block under a step is its command. Re-importing updates titles
and commands but keeps step state. Steps: `todo`, `doing`, `done`,
`blocked`, `skipped`. Never mark a step done unless its command really
succeeded.

## Artifacts and events

- Artifacts are a file path (must exist) or an `http(s)` URL attached to a
  card or the current run. The file is never copied — the database stores the
  pointer. Titles default to the file name or last URL segment.
- Events are append-only facts (`card.posted`, `run.state`, …). Use
  `muster_log_event` for progress worth seeing in the activity feed.

## Style

- Titles are short and concrete. Bodies may be markdown.
- Say what changed, what is uncertain, and what the person should do next.
- Use `dedupe_key` when retrying so one report does not become five.
- Resolve the cards you opened; don't leave finished work in the attention
  list.
- Never put secrets, tokens, or private keys in cards, notes, or events.
