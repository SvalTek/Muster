# Repository Guidelines

## Project Structure & Module Organization

Muster is a Bun and SQLite app with a CLI, MCP server and Herdr target. Shared app code is in `app/`: `store.ts` owns persistence, `api.ts` shares operations, and `mcp.ts` serves MCP. Root `cli.ts` is the entry point and `install.ts` dispatches installation targets. `targets/herdr/` owns its installer, mod, SVG icons, layout, themes and bindings. Tests live in `tests/`; `SPEC.md` documents shared contracts.

## Build, Test, and Development Commands

Run commands from the repository root with Bun 1.1 or newer:

- `bun test` runs the service test suite.
- `bun install` installs development dependencies for type checking.
- `bun run typecheck` runs TypeScript without emitting files.
- `bun run muster -- version` runs the CLI; `bun run mcp` starts its stdio MCP server.

`herdr-app check targets\herdr\mods\muster` checks the mod. Run `muster install` to install the Herdr package; use `--app-home DIR`, `--muster-home DIR`, or `--no-keys` when needed. Run `bun run build-herdr-assets` after changing Herdr assets and `bun run build-skill` after changing skill files.

## Coding Style & Naming Conventions

Follow nearby TypeScript and JavaScript: two-space indentation, double-quoted strings, semicolons, and descriptive camelCase functions and variables. Use PascalCase for types and classes; retain the existing lowercase module names. TypeScript uses strict checking and explicit `.ts` import extensions. Preserve LF line endings for source, JSON, Markdown and SVG; PowerShell files use CRLF, as specified by `.gitattributes`.

## Testing Guidelines

Use Bun's `bun:test` and name tests `*.test.ts` under `tests/`. Add focused coverage for behavior changes, especially project identity, store operations and MCP contracts. Use temporary directories and isolated `MUSTER_HOME`/`MUSTER_DB` values; do not touch a real user database. Run `bun test` and `bun run typecheck` before submitting app changes. No coverage threshold is specified.

## Commits & Pull Requests

Recent commits use short, imperative subjects such as `Add missing artifact CLI commands; polish the Muster agent skill`. Describe the change clearly and keep unrelated work separate. Pull requests should explain behavior changes, identify relevant issues, and report checks run; include screenshots for visible Herdr layout or theme changes.

## Architecture & Configuration

The database is the source of truth for CLI, MCP and views; keep shared behavior in the service and preserve the contracts in `SPEC.md`. MCP stdout is reserved for JSON-RPC, so send diagnostics to stderr. Never put secrets in cards, notes or events.
