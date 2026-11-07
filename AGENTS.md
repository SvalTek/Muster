# Repository Guidelines

## Project Structure & Module Organization

Muster is a Herdr package backed by a local Bun and SQLite service. Service code is in `service/src/`: `store.ts` owns persistence, `api.ts` shares operations, and `cli.ts` and `mcp.ts` expose them. Tests live in `service/test/`. The Herdr views and SVG icons are in `mods/muster/`; layout and theme definitions are in `layouts/` and `themes/`. `keys.json` contains bindings, `install.ps1` installs the package, and `SPEC.md` documents shared contracts.

## Build, Test, and Development Commands

Run service commands from `service/` with Bun 1.1 or newer:

- `bun test` runs the service test suite.
- `bun install` installs development dependencies for type checking.
- `bun run typecheck` runs TypeScript without emitting files.
- `bun run muster -- version` runs the CLI; `bun run mcp` starts its stdio MCP server.

From the repository root, `herdr-app check mods\muster` checks the mod. `pwsh -File .\install.ps1` installs into the local Herdr app home; add `-Compile` to build an executable or `-NoKeys` to skip key binding changes. See the README for custom paths.

## Coding Style & Naming Conventions

Follow nearby TypeScript and JavaScript: two-space indentation, double-quoted strings, semicolons, and descriptive camelCase functions and variables. Use PascalCase for types and classes; retain the existing lowercase module names. TypeScript uses strict checking and explicit `.ts` import extensions. Preserve LF line endings for source, JSON, Markdown and SVG; PowerShell files use CRLF, as specified by `.gitattributes`.

## Testing Guidelines

Use Bun's `bun:test` and name service tests `*.test.ts` under `service/test/`. Add focused coverage for behavior changes, especially project identity, store operations and MCP contracts. Use temporary directories and isolated `MUSTER_HOME`/`MUSTER_DB` values; do not touch a real user database. Run `bun test` and `bun run typecheck` before submitting service changes. No coverage threshold is specified.

## Commits & Pull Requests

Recent commits use short, imperative subjects such as `Add missing artifact CLI commands; polish the Muster agent skill`. Describe the change clearly and keep unrelated work separate. Pull requests should explain behavior changes, identify relevant issues, and report checks run; include screenshots for visible Herdr layout or theme changes.

## Architecture & Configuration

The database is the source of truth for CLI, MCP and views; keep shared behavior in the service and preserve the contracts in `SPEC.md`. MCP stdout is reserved for JSON-RPC, so send diagnostics to stderr. Never put secrets in cards, notes or events.
