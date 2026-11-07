# Muster

Muster is a Herdr theme and attention board for coding agents, with a CLI and
an MCP server. Agents report what they are doing, ask for decisions, and leave
durable cards behind. A person can watch their work in one Herdr window.

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

- [Bun](https://bun.sh) 1.1 or newer for the CLI and MCP server.
- Windows 10/11 and a Herdr install at `%USERPROFILE%\.config\herdr-app` for
  the Herdr theme and board. The service also runs on macOS and Linux.
- Git is optional; without it, Muster falls back to the folder name.

Muster has no runtime dependencies. The service uses Bun's built-in SQLite.

## Install

Install the CLI and MCP server from the latest stable `main` commit:

```powershell
bun install -g 'github:SvalTek/Muster#main'
muster skill
```

Ensure Bun's global bin directory is on `PATH`. For an MCP client, configure
`muster` as the command and `mcp` as its argument. `muster skill` prints the
agent guide. Development takes place on `develop`; `main` is the stable branch.
To update an existing installation to the latest `main` commit, run
`bun update -g muster-agent`.

From a checkout, `bun install -g .` installs the same CLI. Bun must be installed
and its global bin directory must be on `PATH`. A compiled executable works
without Bun; put it on `PATH` and use the same commands. `bunx` runs a package
but does not install it globally.

To install the Herdr theme, layout and mod, run:

```powershell
muster install
```

This installs the embedded theme, layout, mod and a self-contained service into
the Herdr app home. It creates the data folder (`%LOCALAPPDATA%\Muster` on
Windows), writes `muster.json`, and adds missing `layout:muster` key bindings
without replacing existing ones. Changed key bindings and an existing modified
Muster layout are backed up. Running the command again updates Muster.

Options:

```powershell
muster install herdr --no-keys
muster install --app-home D:\herdr-app --muster-home D:\muster-data
```

Then show the layout. Either press **Ctrl+Shift+L** until Muster comes up, or
open the command palette (**Ctrl+Shift+P**) and run *Show layout: Muster*. To
give it its own key, add this to the `global` section of `keys.json`:

```json
"alt-m": "layout.switch:muster"
```

Claude Code, Codex, or any other MCP client can now connect to the service.

## Turn off or uninstall the Herdr integration

If Herdr is open, switch to another layout and theme if possible, then close
Herdr. Run:

```powershell
muster uninstall
```

Use `muster uninstall --app-home D:\herdr-app` for a custom app home. The
command removes Muster's layout, mod and theme files, backing up modified files.
It removes only unchanged key bindings recorded as added by Muster; older
installations without that record keep their bindings. The database, backups,
global CLI and MCP client configurations are kept. Reopen Herdr with another
layout; run `muster install` to install the integration again.

If the CLI cannot start, close Herdr and rename `layouts/muster.json` and
`mods/muster/mod.json` in the Herdr app home (for example, give each a
`.disabled` extension). That makes the layout and mod unavailable without
deleting their contents or the database. The default app home on Windows is
`%USERPROFILE%\.config\herdr-app`.

## Connect an agent

The MCP server is the same executable as the CLI, with `mcp` after it. After
the global install, configure your client to run `muster mcp`.

Claude Code:

```powershell
claude mcp add --transport stdio muster -- muster mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.muster]
command = "muster"
args = ["mcp"]
```

Any client that speaks stdio MCP:

```json
{
  "mcpServers": {
    "muster": {
      "command": "muster",
      "args": ["mcp"]
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
muster skill [skill|cli|mcp|cards|all]
```

`muster skill` prints the bundled workflow guide; pass `cli`, `mcp`, `cards`,
or `all` to read guides. Other arguments search all bundled skill files, for
example `muster skill pending`. MCP clients can read `muster://skill` or use
`muster://skill?section=pending`. The resource template is
`muster://skill{?section}`. These guides are embedded in the app and
compiled executable; regenerate them with `bun run build-skill` after editing
`.agents/skills/muster/`.

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
cli.ts, install.ts  command-line entry point and install dispatcher
app/                SQLite store, project logic, skill and MCP server
targets/herdr/      Herdr installer, themes, layout, mod and bindings
tests/              app and installation tests
scripts/            embedded asset and skill generators
docs/               agent snippet and package notes
SPEC.md             model, wire formats and decisions
```

## Development

```powershell
bun install              # development dependencies, including the type checker
bun test                 # application and installer tests
bun run typecheck
herdr-app check targets\herdr\mods\muster
```

The tests use temporary folders and never touch `%LOCALAPPDATA%\Muster`.

## Build channels

GitHub Actions tests changes on Windows and Linux, then builds standalone
executables for Windows x64, Linux x64/arm64, and macOS x64/arm64. Successful
builds appear in [GitHub Releases](https://github.com/SvalTek/Muster/releases):

- `stable` follows the latest successful build of `main` and is the latest release.
- `dev` follows `develop` and is a prerelease.
- `pr-N` follows the current head of open pull request N and is an untrusted
  prerelease preview. A newer build replaces its assets.

The tags are rolling channels rather than permanent version numbers. CI runs
with read-only permissions; a separate publisher checks that the branch or PR
still points at the built commit before attaching artifacts. GitHub only runs
the publisher once its workflow file exists on the default branch (`main`).

## Scope

v1 is the board, cards, runbooks and stats. Deferred: inbox and mail
integrations, CI status, monitors, remote/shared stores, and any host-specific
assumptions such as unix sockets, `sh -c`, `lsof` or `sips`. The app is
plain TypeScript on Bun, so a hosted or remote store can be added behind the
same CLI and MCP surface later.
