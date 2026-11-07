# Muster

Muster is a project-scoped attention board for coding agents, built as a Herdr
package. Agents report what they are doing, ask for decisions instead of
guessing, and leave durable cards behind. A person watches one quiet window
instead of five terminals.

Muster is standalone. It borrows Kanso's calm, flat visual language and
cockpit's card and runbook ideas, but it has its own service, store, theme,
layout and mod.

- **Cards** are durable: a result, a risk, a failing check, a question, an
  approval.
- **Runs** are ephemeral: one run per agent session, with a heartbeat and a
  one-line state.
- **Runbooks** are ordered steps imported from markdown; re-importing keeps the
  state of each step.
- **Projects** are inferred from the folder, a `.muster.json` marker, or the
  canonical git remote, so worktrees and SSH/HTTPS clones agree.

## Requirements

- Windows 10/11 (the service also runs on macOS and Linux).
- [Bun](https://bun.sh) 1.1 or newer.
- A Herdr install with the app home at `%USERPROFILE%\.config\herdr-app`.
- Git is optional; without it, Muster falls back to the folder name.

Muster has no runtime dependencies. The service uses Bun's built-in SQLite.

## Install

From this folder:

```powershell
pwsh -File .\install.ps1
```

The script copies the theme, layout, mod and service into the Herdr app home,
creates the data folder (`%LOCALAPPDATA%\Muster`), writes the mod's install
record (`muster.json`), and merges the `layout:muster` key bindings into
`keys.json` without overwriting existing keys. It backs up `keys.json` first.

Options:

```powershell
pwsh -File .\install.ps1 -Compile          # build a single muster.exe with Bun
pwsh -File .\install.ps1 -NoKeys           # do not touch keys.json
pwsh -File .\install.ps1 -AppHome  D:\herdr-app -MusterHome D:\muster-data
```

Then show the layout. Either press **Ctrl+Shift+L** until Muster comes up, or
open the command palette (**Ctrl+Shift+P**) and run *Show layout: Muster*. To
give it its own key, add this to the `global` section of `keys.json`:

```json
"alt-m": "layout.switch:muster"
```

Claude Code, Codex, or any other MCP client can now connect to the service.

## Connect an agent

The MCP server is the same executable as the CLI, with `mcp` after it. Use the
path the installer wrote (or run `Get-Content "$env:USERPROFILE\.config\herdr-app\muster.json"`).

Claude Code:

```powershell
$svc = "$env:USERPROFILE\.config\herdr-app\service\src\cli.ts"
claude mcp add --transport stdio muster -- bun $svc mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.muster]
command = "bun"
args = ["C:\\Users\\you\\.config\\herdr-app\\service\\src\\cli.ts", "mcp"]
```

Any client that speaks stdio MCP:

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

Muster never writes to stdout except JSON-RPC. Logs go to stderr. The server
supports MCP `2025-06-18`, `2025-03-26` and `2024-11-05`, and falls back to the
newest when a client asks for an unknown version.

If the agent cannot use MCP, the same operations are a CLI. Put the snippet in
[`docs/agents-snippet.md`](docs/agents-snippet.md) in the repository's
`AGENTS.md` or `CLAUDE.md` and give the agent the command path in its prompt.

## Use

The layout has five places:

| Place | What it shows |
| --- | --- |
| **Board** | Every project with needs, open cards, live runs and the next move. |
| **Cards** | The attention-ordered list for the selected project, and the selected card: markdown, refs, artifacts, answers and buttons. |
| **Runbook** | Steps grouped by project, with progress and one press per state change. |
| **Stats** | Counts, response times, a 14-day activity series and a project table. |
| **Terminals** | The normal Herdr panes, with a project header. |

Bindings inside the Muster layout:

| Key | Action |
| --- | --- |
| `Ctrl+Shift+1` | Board |
| `Ctrl+Shift+2` | Cards |
| `Ctrl+Shift+3` | Runbook |
| `Ctrl+Shift+4` | Stats |
| `Ctrl+Shift+5` | Terminals |
| `Ctrl+Shift+M` | Jump to the next card that needs a person |
| `Ctrl+Shift+R` | Refresh the snapshot |

Dangerous actions arm first: **Dismiss** asks for a second press within four
seconds. Answers, resolves and runbook steps act immediately.

The window reads a snapshot from the CLI every three seconds and after every
press. Nothing is optimistic: if the CLI fails, the footer says so and the
window keeps the last good state.

## The CLI

```text
muster init [--name N] [--id ID] [--color #hex] [--runbook path] [--force]
muster resolve [path]
muster whoami [--path DIR] [--agent A] [--terminal T]
muster status <working|blocked|waiting|done|failed|idle> [summary]
muster ask --question Q [--choice id:label]... [--timeout S]
muster card post --title T [--body B] [--kind K] [--severity S]
muster card list [--state open]... [--project KEY] [--all]
muster card show <id>
muster card answer <id> [--action ID] [--text T] [--note N]
muster card resolve <id> [--resolution R]
muster card dismiss <id>
muster event log --kind K [--data JSON]
muster runbook import <file.md> [--slug S]
muster runbook list|show [--slug S]
muster runbook step <n> <todo|doing|done|blocked|skipped> [--slug S]
muster board | stats | snapshot | projects | runs | doctor | mcp | version
```

Add `--json` to any command for machine output. `--path` resolves a project
from another folder; `--project` uses a project key directly. `MUSTER_HOME`
and `MUSTER_DB` override the data folder and database.

## The marker

`.muster.json` is optional. It pins a project's identity and can point at a
runbook:

```json
{
  "id": "gh:acme/api",
  "name": "Acme API",
  "color": "#8fa58a",
  "runbook": "docs/release.md",
  "links": [{ "label": "Staging", "url": "https://staging.acme.example" }]
}
```

Resolution order: marker `id` → canonical git remote → manifest name → folder
name plus a path hash. SSH and HTTPS remotes normalize to one key
(`git@github.com:acme/api.git` and `https://github.com/acme/api` both become
`gh:acme/api`). Git worktrees share the main repository's key.

`muster init` writes the marker. You do not need one until you want an override.

## Data and privacy

Everything lives in one SQLite database:

```text
%LOCALAPPDATA%\Muster\muster.db
```

Cards, runs, events, artifacts and runbook steps are local. Muster makes no
network calls and has no telemetry. An artifact is a path or a URL, not a copy:
the file stays where it is. Never put secrets in a card, note or event.

## Repository layout

```text
themes/       muster.json (dark), muster-day.json (light)
layouts/      muster.json
keys.json     the layout:muster bindings
mods/muster/  one mod, one view per props.app
service/      Bun service: SQLite store, CLI, MCP server, tests
docs/         agent snippet and this package's notes
install.ps1   copy, compile, and merge keys
SPEC.md       the model, the wire formats and the decisions
```

## Development

```powershell
cd service
bun test                 # 33 tests: project resolution, store, MCP protocol
bun install              # only for the type checker
bun run typecheck
cd ..
herdr-app check mods\muster
```

The tests use temporary folders and never touch `%LOCALAPPDATA%\Muster`.

## Scope

v1 is the board, cards, runbooks and stats. Deferred: inbox and mail
integrations, CI status, monitors, remote/shared stores, and any host-specific
assumptions such as unix sockets, `sh -c`, `lsof` or `sips`. The service is
plain TypeScript on Bun, so a hosted or remote store can be added behind the
same CLI and MCP surface later.
