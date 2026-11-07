#!/usr/bin/env bun
// `muster`: the one surface agents, scripts and the Herdr mods use. Every
// command accepts `--json` and prints the same objects the MCP tools return.

import {
  addArtifactFor,
  answerCardById,
  askHuman,
  awaitCard,
  boardView,
  claimCardById,
  dismissCardById,
  doctor,
  eventsView,
  importRunbookFor,
  listArtifactsFor,
  listCardsFor,
  logEventFor,
  MusterError,
  postCardFor,
  projectShape,
  reportStatus,
  resolveCardById,
  runbookGet,
  runbookStep,
  runsView,
  showCard,
  snapshotView,
  statsView,
  whoami,
} from "./api.ts";
import { initMarker, resolveProject } from "./projects.ts";
import { skillText } from "./skill.ts";
import { listProjects as readProjects, type CardState, type RunState, type StepState } from "./store.ts";
import { ageText, plural } from "./util.ts";
import { MUSTER_VERSION } from "./version.ts";

const BOOLEAN = new Set(["json", "force", "help", "version", "all", "live", "quiet"]);
const REPEATED = new Set(["action", "choice", "ref", "state"]);

class Flags {
  constructor(
    readonly values: Map<string, string | boolean | string[]>,
    readonly positionals: string[],
  ) {}

  string(name: string): string | undefined {
    const value = this.values.get(name);
    return typeof value === "string" ? value : undefined;
  }

  bool(name: string): boolean {
    const value = this.values.get(name);
    return value === true || value === "true" || value === "1";
  }

  list(name: string): string[] {
    const value = this.values.get(name);
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return [];
  }

  number(name: string): number | undefined {
    const value = this.string(name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  require(name: string): string {
    const value = this.string(name);
    if (!value?.trim()) throw new MusterError("usage", `--${name} is required.`);
    return value.trim();
  }
}

function parse(argv: string[]): Flags {
  const values = new Map<string, string | boolean | string[]>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    const name = equals >= 0 ? body.slice(0, equals) : body;
    let value: string | boolean | undefined = equals >= 0 ? body.slice(equals + 1) : undefined;

    if (REPEATED.has(name)) {
      const next = value ?? argv[++i];
      if (next === undefined) throw new MusterError("usage", `--${name} needs a value.`);
      const list = (values.get(name) as string[] | undefined) ?? [];
      list.push(next);
      values.set(name, list);
      continue;
    }

    if (value === undefined) {
      if (BOOLEAN.has(name)) {
        value = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value = next;
          i++;
        } else {
          value = true;
        }
      }
    }
    values.set(name, value);
  }
  return new Flags(values, positionals);
}

const USAGE = `muster ${MUSTER_VERSION} — project-scoped attention for coding agents

Usage:
  muster init [--name N] [--id ID] [--color #hex] [--runbook path] [--force]
  muster resolve [path] [--json]
  muster whoami [--path DIR] [--agent A] [--terminal T]
  muster status <working|blocked|waiting|done|failed|idle> [summary]
  muster ask --question Q [--choice id:label]... [--timeout S] [--dedupe K]
  muster card post --title T [--body B] [--kind K] [--severity S]
                    [--action id:label[:primary|danger]]... [--dedupe K]
  muster card list [--state open]... [--project KEY] [--all]
  muster card show <id>
  muster card answer <id> [--action ID] [--text T] [--note N] [--version N]
  muster card claim <id>
  muster card resolve <id> [--resolution R]
  muster card dismiss <id>
  muster event log --kind K [--data JSON]
  muster event list [--project KEY] [--limit N]
  muster artifact add [--card ID] (--file F | --url U) [--title T] [--mime M]
  muster artifact list [--card ID] [--project KEY]
  muster runbook import <file.md> [--slug S] [--title T]
  muster runbook list [--project KEY]
  muster runbook show [--slug S] [--project KEY]
  muster runbook step <n> <todo|doing|done|blocked|skipped> [--slug S] [--note N]
  muster board [--days N]
  muster stats [--days N]
  muster snapshot [--days N]
  muster skill [section or search]  # skill | cli | mcp | cards | all, or search text
  muster projects
  muster runs [--project KEY] [--all]
  muster doctor
  muster mcp
  muster version

Global:
  --json            machine-readable output
  --path DIR        resolve the project from DIR instead of the current folder
  --project KEY     use a project key directly
  --db FILE         use another database (or set MUSTER_DB)
  --agent NAME      the agent name recorded on the run
  --terminal ID     the terminal handle recorded on the run`;

function humanProject(project: ReturnType<typeof resolveProject>): void {
  console.log(`${project.name}  ${project.key}`);
  console.log(`  root    ${project.root}`);
  console.log(`  source  ${project.source}${project.remote ? `  ${project.remote}` : ""}`);
  console.log(`  color   ${project.color}`);
  if (project.markerPath) console.log(`  marker  ${project.markerPath}`);
}

function cardMark(card: { state: string; severity: string; kind: string }): string {
  if (card.state === "answered") return "[✓]";
  if (card.state === "resolved") return "[·]";
  if (card.state === "dismissed") return "[×]";
  if (card.severity === "blocked") return "[!]";
  if (card.kind === "question" || card.kind === "approval") return "[?]";
  return "[.]";
}

function humanCard(card: {
  id: string;
  state: string;
  severity: string;
  kind: string;
  title: string;
  updatedAt: string;
  project?: { name: string };
}): void {
  const project = card.project?.name ? `  ${card.project.name}` : "";
  console.log(`${cardMark(card)} ${card.title}${project}`);
  console.log(`    ${card.id}  ${card.kind} · ${card.state} · ${card.severity} · ${ageText(card.updatedAt)}`);
}

function parseAction(raw: string): { id: string; label: string; style?: "primary" | "secondary" | "danger" } {
  const parts = raw.split(":");
  const id = parts.shift()?.trim();
  if (!id) throw new MusterError("usage", `Bad --action: ${raw}`);
  const last = parts[parts.length - 1]?.trim().toLowerCase();
  const style = last === "primary" || last === "danger" || last === "secondary" ? (parts.pop() as "primary" | "secondary" | "danger") : undefined;
  const label = parts.join(":").trim() || id;
  return { id, label, style };
}

function parseChoice(raw: string): { id: string; label: string; style?: "primary" | "secondary" | "danger" } {
  return parseAction(raw);
}

function parseRefs(raw: string[]): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const entry of raw) {
    const index = entry.indexOf("=");
    if (index < 1) throw new MusterError("usage", `Bad --ref: ${entry} (want key=value)`);
    refs[entry.slice(0, index).trim()] = entry.slice(index + 1).trim();
  }
  return refs;
}

async function main(): Promise<void> {
  const flags = parse(process.argv.slice(2));
  const json = flags.bool("json");
  const dbOverride = flags.string("db");
  if (dbOverride) process.env.MUSTER_DB = dbOverride;

  const [command = flags.bool("version") ? "version" : "help", sub = "", ...rest] = flags.positionals;
  const ctx = {
    path: flags.string("path"),
    agent: flags.string("agent"),
    terminal: flags.string("terminal"),
  };
  const projectKey = flags.string("project");

  const emit = (value: unknown, human?: () => void): void => {
    if (json) console.log(JSON.stringify(value, null, 2));
    else if (human) human();
    else console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  };

  switch (command) {
    case "help":
    case "--help":
    case "-h": {
      console.log(USAGE);
      return;
    }
    case "version": {
      emit({ version: MUSTER_VERSION }, () => console.log(`muster ${MUSTER_VERSION}`));
      return;
    }
    case "init": {
      const result = initMarker(ctx.path ?? process.cwd(), {
        name: flags.string("name"),
        id: flags.string("id"),
        color: flags.string("color"),
        runbook: flags.string("runbook"),
        force: flags.bool("force"),
      });
      emit(result, () => {
        console.log(`Wrote ${result.path}`);
        humanProject(result.project);
      });
      return;
    }
    case "resolve": {
      const project = resolveProject(ctx.path ?? (sub || rest[0]) ?? process.cwd());
      emit(project, () => humanProject(project));
      return;
    }
    case "whoami": {
      const result = whoami(ctx);
      emit(result, () => {
        console.log(`${result.project.name}  ${result.project.key}`);
        console.log(`  root    ${result.project.root}`);
        console.log(`  source  ${result.project.source}${result.project.remote ? `  ${result.project.remote}` : ""}`);
        console.log(`  branch  ${result.run.branch ?? "—"}`);
        console.log(`  run     ${result.run.id}  ${result.run.state}`);
        console.log(`  next    ${result.next.label}`);
        if (result.cards.length) {
          console.log("");
          for (const card of result.cards) humanCard(card);
        }
      });
      return;
    }
    case "status": {
      const state = (sub || "working") as RunState;
      const summary = flags.string("summary") ?? (rest.join(" ").trim() || undefined);
      const result = reportStatus(ctx, state, summary);
      emit(result, () => {
        console.log(`${result.project.name}  ${result.run.state}${result.run.summary ? `  ${result.run.summary}` : ""}`);
      });
      return;
    }
    case "ask": {
      const question = flags.string("question") ?? rest.join(" ").trim();
      if (!question) throw new MusterError("usage", "ask needs --question.");
      const result = await askHuman(ctx, {
        question,
        title: flags.string("title"),
        choices: flags.list("choice").map(parseChoice),
        timeoutS: flags.number("timeout") ?? 25,
        dedupeKey: flags.string("dedupe"),
        refs: parseRefs(flags.list("ref")),
      });
      emit(result, () => {
        humanCard(result.card);
        if (result.state === "pending") console.log(`\nWaiting for an answer: muster_await_card ${result.card.id}`);
        else if (result.answer?.actionId) console.log(`\nAnswer: ${result.answer.actionId}`);
        else if (result.answer?.text) console.log(`\nAnswer: ${result.answer.text}`);
        else console.log(`\n${result.state}`);
      });
      return;
    }
    case "answer": {
      if (!sub) throw new MusterError("usage", "answer needs a card id.");
      const card = answerCardById(
        sub,
        {
          actionId: flags.string("action"),
          text: flags.string("text"),
          note: flags.string("note"),
        },
        { expectedVersion: flags.number("version") },
      );
      emit(card, () => humanCard(card));
      return;
    }
    case "card": {
      if (!sub || sub === "list") {
        const states = flags.bool("all") ? undefined : (flags.list("state") as CardState[]);
        const cards = listCardsFor({
          projectKey,
          path: ctx.path,
          states: states?.length ? states : undefined,
          limit: flags.number("limit"),
          all: flags.bool("all"),
        });
        emit(cards, () => {
          if (!cards.length) console.log("No cards.");
          for (const card of cards) humanCard(card);
        });
        return;
      }
      if (sub === "post") {
        const result = postCardFor(ctx, {
          title: flags.require("title"),
          body: flags.string("body"),
          kind: flags.string("kind") as never,
          severity: flags.string("severity") as never,
          actions: flags.list("action").map(parseAction),
          dedupeKey: flags.string("dedupe"),
          refs: parseRefs(flags.list("ref")),
        });
        emit(result, () => humanCard(result.card));
        return;
      }
      if (sub === "show") {
        if (!rest[0]) throw new MusterError("usage", "card show needs an id.");
        const result = showCard(rest[0]);
        emit(result, () => {
          humanCard(result.card);
          if (result.card.body) console.log(`\n${result.card.body}`);
          for (const action of result.card.actions) {
            console.log(`  [${action.id}] ${action.label}${action.style === "primary" ? "  (primary)" : ""}`);
          }
          if (result.artifacts.length) {
            console.log(`\nArtifacts:`);
            for (const artifact of result.artifacts) console.log(`  ${artifact.kind}  ${artifact.title}  ${artifact.path ?? artifact.url}`);
          }
        });
        return;
      }
      if (sub === "claim") {
        if (!rest[0]) throw new MusterError("usage", "card claim needs an id.");
        const card = claimCardById(rest[0], ctx.agent);
        emit(card, () => humanCard(card));
        return;
      }
      if (sub === "answer") {
        if (!rest[0]) throw new MusterError("usage", "card answer needs an id.");
        const card = answerCardById(
          rest[0],
          { actionId: flags.string("action"), text: flags.string("text"), note: flags.string("note") },
          { expectedVersion: flags.number("version"), actor: ctx.agent },
        );
        emit(card, () => humanCard(card));
        return;
      }
      if (sub === "resolve") {
        if (!rest[0]) throw new MusterError("usage", "card resolve needs an id.");
        const card = resolveCardById(rest[0], flags.string("resolution"), ctx.agent);
        emit(card, () => humanCard(card));
        return;
      }
      if (sub === "dismiss") {
        if (!rest[0]) throw new MusterError("usage", "card dismiss needs an id.");
        const card = dismissCardById(rest[0], ctx.agent);
        emit(card, () => humanCard(card));
        return;
      }
      throw new MusterError("usage", `Unknown card command: ${sub}`);
    }
    case "event": {
      if (!sub || sub === "list") {
        const events = eventsView({ projectKey, cardId: flags.string("card"), limit: flags.number("limit") });
        emit(events, () => {
          for (const event of events) {
            console.log(`${event.at.slice(11, 19)}  ${event.kind.padEnd(16)} ${JSON.stringify(event.payload)}`);
          }
        });
        return;
      }
      if (sub === "log") {
        const kind = flags.require("kind");
        const data = flags.string("data") ? (JSON.parse(flags.string("data") as string) as Record<string, unknown>) : {};
        const result = logEventFor(ctx, kind, data);
        emit(result, () => console.log(`Logged ${kind}.`));
        return;
      }
      throw new MusterError("usage", `Unknown event command: ${sub}`);
    }
    case "artifact": {
      if (!sub || sub === "list") {
        const result = listArtifactsFor({ projectKey, path: ctx.path, cardId: flags.string("card") });
        emit(result, () => {
          if (!result.length) console.log("No artifacts.");
          for (const artifact of result) {
            console.log(`${artifact.kind}  ${artifact.title}  ${artifact.path ?? artifact.url}`);
          }
        });
        return;
      }
      if (sub === "add") {
        const result = addArtifactFor(ctx, {
          cardId: flags.string("card") ?? null,
          path: flags.string("file") ?? rest[0],
          url: flags.string("url"),
          title: flags.string("title"),
          mime: flags.string("mime"),
        });
        emit(result, () => console.log(`Added ${result.kind} ${result.title}`));
        return;
      }
      throw new MusterError("usage", `Unknown artifact command: ${sub}`);
    }
    case "runbook": {
      if (!sub || sub === "list" || sub === "show") {
        const result = runbookGet({ projectKey, path: ctx.path, slug: flags.string("slug") });
        if (json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!result.runbooks.length) {
          console.log("No runbooks. Add \"runbook\": \"docs/runbook.md\" to .muster.json, or run `muster runbook import`.");
        } else {
          for (const book of result.runbooks) {
            console.log(`${book.title}  ${book.slug}`);
            for (const step of book.steps) {
              const mark = step.state === "done" ? "[✓]" : step.state === "blocked" ? "[!]" : step.state === "doing" ? "[>]" : step.state === "skipped" ? "[-]" : "[ ]";
              console.log(`  ${mark} ${step.n}. ${step.title}${step.command ? `   $ ${step.command.split("\n")[0]}` : ""}`);
            }
          }
        }
        return;
      }
      if (sub === "import") {
        const file = rest[0] ?? flags.string("file");
        if (!file) throw new MusterError("usage", "runbook import needs a markdown file.");
        const imported = importRunbookFor({
          projectKey,
          path: ctx.path,
          file,
          slug: flags.string("slug"),
          title: flags.string("title"),
        });
        emit(imported, () => console.log(`Imported ${imported.slug}: ${plural(imported.steps.length, "step")}.`));
        return;
      }
      if (sub === "step") {
        const n = Number(rest[0]);
        const state = (rest[1] ?? "done") as StepState;
        if (!Number.isFinite(n) || n < 1) throw new MusterError("usage", "runbook step needs a step number.");
        const book = runbookGet({ projectKey, path: ctx.path, slug: flags.string("slug") });
        const slug = flags.string("slug") ?? book.runbooks[0]?.slug;
        if (!slug) throw new MusterError("runbook_missing", "No runbook for this project.");
        const updated = runbookStep({ projectKey, path: ctx.path, slug, n, state, note: flags.string("note") });
        emit(updated, () => {
          const step = updated.steps.find((entry) => entry.n === n);
          console.log(`${step?.state === "done" ? "[✓]" : "[·]"} ${slug} ${n}. ${step?.title ?? ""}`);
        });
        return;
      }
      throw new MusterError("usage", `Unknown runbook command: ${sub}`);
    }
    case "board": {
      const rows = boardView({ days: flags.number("days") });
      emit(rows, () => {
        if (!rows.length) {
          console.log("No projects yet. Run `muster whoami` inside a repository.");
          return;
        }
        for (const row of rows) {
          const counts = `${row.needs} needs · ${row.openCards} open · ${row.liveRuns} live`;
          console.log(`${row.name.padEnd(22)} ${counts}`);
          console.log(`  ${row.next.kind}: ${row.next.label}`);
        }
      });
      return;
    }
    case "stats": {
      const value = statsView({ days: flags.number("days") });
      emit(value, () => {
        console.log(`${value.totals.projects} projects · ${value.totals.runsLive} live runs · ${value.totals.cardsOpen} open cards · ${value.totals.cardsNeeds} need you`);
        const response = value.response.medianSeconds === null ? "—" : `${Math.round(value.response.medianSeconds / 60)}m`;
        console.log(`median answer ${response}  ·  answered ${value.response.answered}  ·  window ${value.windowDays}d`);
      });
      return;
    }
    case "snapshot": {
      const value = snapshotView({ days: flags.number("days") });
      emit(value, () => {
        console.log(`${value.board.length} projects · ${value.cards.length} cards · ${value.stats.totals.cardsNeeds} need you`);
      });
      return;
    }
    case "skill": {
      const section = [sub, ...rest].filter(Boolean).join(" ") || flags.string("section");
      const text = skillText(section);
      if (json) console.log(JSON.stringify({ section: section ?? "skill", text }, null, 2));
      else process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      return;
    }
    case "projects": {
      const rows = readProjects((await import("./db.ts")).getDb());
      emit(rows, () => {
        for (const row of rows) console.log(`${row.name.padEnd(22)} ${row.key}  ${row.source}`);
      });
      return;
    }
    case "runs": {
      const rows = runsView({ projectKey, live: !flags.bool("all") });
      emit(rows, () => {
        for (const run of rows) {
          console.log(`${run.state.padEnd(8)} ${run.agent ?? run.terminal ?? "—"}  ${run.branch ?? ""}  ${ageText(run.heartbeatAt)}`);
        }
      });
      return;
    }
    case "doctor": {
      const report = doctor();
      emit(report, () => {
        console.log(`muster ${report.version}  bun ${report.bun}  ${report.platform}`);
        console.log(`home  ${report.home}`);
        console.log(`db    ${report.db}${report.dbExists ? "" : " (not created yet)"}`);
        for (const check of report.checks) console.log(`${check.ok ? "ok  " : "warn"} ${check.name.padEnd(12)} ${check.detail}`);
      });
      return;
    }
    case "mcp": {
      const { startMcp } = await import("./mcp.ts");
      await startMcp();
      return;
    }
    default: {
      throw new MusterError("usage", `Unknown command: ${command}\n\n${USAGE}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof MusterError ? error.code : "error";
  const json = process.argv.includes("--json");
  if (json) console.log(JSON.stringify({ error: { code, message } }, null, 2));
  else console.error(`muster: ${message}`);
  process.exitCode = 1;
});
