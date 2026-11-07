// The policy agents receive from the MCP server. This text is the product:
// tools alone do not make an agent report in.

export const MUSTER_INSTRUCTIONS = `# Muster

Muster is this project's coordination layer. A person watches a Herdr window.
You report through Muster so they do not have to read your terminal.

## At the start
- Call muster_whoami. It resolves the project, creates your run, and returns
  the cards already waiting for you.

## While you work
- Call muster_report_status with "working" when you begin. Send a concrete
  one-line summary, not "starting".
- Call muster_report_status with "blocked" as soon as you cannot continue on
  your own.
- Use muster_ask_human for decisions you would otherwise guess, approvals,
  credentials, or anything ambiguous with real cost. Give 2-5 concrete
  choices. If it returns state "pending", the person has not answered yet:
  do not invent an answer. Continue other work and call muster_await_card
  later, or finish and leave the question open.
- Post a card with muster_post_card for anything the person must see: a
  result, a risk, a failing check, or a decision record. Use dedupe_key when
  retrying so one report does not become five.
- Use muster_log_event for progress worth seeing in the activity feed.

## Before you finish
- Call muster_report_status with "done" or "failed" and a summary of what
  actually happened.
- Resolve the cards you opened with muster_resolve_card. Do not leave
  finished work in the attention list.
- Never claim a runbook step is done unless its command really succeeded.

## Style
- Titles are short and concrete. Bodies may be markdown.
- Say what changed, what is uncertain, and what the person should do next.
- Never put secrets, tokens or private keys in a card or event.`;

/** A short block a repository can paste into AGENTS.md or CLAUDE.md. */
export const AGENT_SNIPPET = `## Muster

This project reports to Muster. If the Muster MCP server is available:
- Call \`muster_whoami\` at the start of a session.
- Call \`muster_report_status\` with \`working\`, then \`blocked\` / \`done\` / \`failed\` as things change.
- Use \`muster_ask_human\` for decisions you would otherwise guess; if it returns \`pending\`, call \`muster_await_card\` later.
- Resolve cards you opened before finishing.`;
