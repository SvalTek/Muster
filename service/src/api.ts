// The operations behind both the CLI and the MCP server. Every function here
// is JSON-in / JSON-out so an agent, a script and the Herdr mods get the same
// answers.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "./db.ts";
import { MUSTER_INSTRUCTIONS } from "./instructions.ts";
import { databasePath, musterHome } from "./paths.ts";
import { resolveProject } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import {
  addArtifact,
  answerCard,
  board,
  claimCard,
  dismissCard,
  ensureProject,
  ensureRun,
  getCard,
  getProject,
  importRunbook,
  listArtifacts,
  listCards,
  listEvents,
  listRuns,
  listRunbooks,
  MusterError,
  postCard,
  resolveCard,
  setRunbookStep,
  setRunState,
  snapshot,
  stats as buildStats,
  type AddArtifactInput,
  type Card,
  type CardAnswer,
  type CardKind,
  type CardSeverity,
  type CardState,
  type Project,
  type Run,
  type RunState,
  type Snapshot,
  type Stats,
  type StepState,
} from "./store.ts";
import { MUSTER_VERSION } from "./version.ts";

export interface AgentContext {
  path?: string;
  agent?: string;
  terminal?: string;
}

interface Located {
  resolved: ResolvedProject;
  project: Project;
}

function located(ctx: AgentContext): Located {
  const resolved = resolveProject(ctx.path ?? process.cwd());
  return { resolved, project: ensureProject(getDb(), resolved) };
}

interface Live extends Located {
  run: Run;
  cwd: string;
}

function live(ctx: AgentContext): Live {
  const base = located(ctx);
  const cwd = resolve(ctx.path ?? process.cwd());
  const run = ensureRun(getDb(), base.project.id, {
    agent: ctx.agent ?? null,
    terminal: ctx.terminal ?? null,
    cwd,
    branch: base.resolved.git?.branch ?? null,
    worktree: base.resolved.git?.worktree ? base.resolved.git.top : null,
  });
  return { ...base, run, cwd };
}

export function projectShape(project: Project, resolved?: ResolvedProject) {
  return {
    key: project.key,
    name: project.name,
    color: project.color,
    root: project.root,
    source: project.source,
    remote: project.remote,
    marker: project.marker,
    ...(resolved?.git
      ? { git: { branch: resolved.git.branch, worktree: resolved.git.worktree, common: resolved.git.common } }
      : {}),
  };
}

export function runShape(run: Run) {
  return {
    id: run.id,
    agent: run.agent,
    terminal: run.terminal,
    cwd: run.cwd,
    branch: run.branch,
    worktree: run.worktree,
    state: run.state,
    summary: run.summary,
    started_at: run.startedAt,
    heartbeat_at: run.heartbeatAt,
    ended_at: run.endedAt,
  };
}

export function whoami(ctx: AgentContext = {}) {
  const db = getDb();
  const here = live(ctx);
  const cards = listCards(db, { projectId: here.project.id, limit: 20 });
  const rollup = board(db).find((row) => row.id === here.project.id);
  return {
    project: projectShape(here.project, here.resolved),
    run: runShape(here.run),
    cards,
    next: rollup?.next ?? { kind: "clear", label: "Nothing needs you" },
    instructions: MUSTER_INSTRUCTIONS,
  };
}

export function reportStatus(ctx: AgentContext, state: RunState, summary?: string) {
  const here = live(ctx);
  const run = setRunState(getDb(), here.run.id, state, summary);
  return { project: projectShape(here.project, here.resolved), run: runShape(run) };
}

export interface PostCardOptions {
  title: string;
  kind?: CardKind;
  body?: string;
  severity?: CardSeverity;
  actions?: Array<{ id: string; label: string; style?: "primary" | "secondary" | "danger"; confirm?: boolean | string }>;
  refs?: Record<string, unknown>;
  dedupeKey?: string;
}

export function postCardFor(ctx: AgentContext, options: PostCardOptions) {
  const db = getDb();
  const here = live(ctx);
  const kind = options.kind ?? "report";
  const severity = options.severity ?? (kind === "question" || kind === "approval" ? "attention" : "info");
  const result = postCard(db, {
    projectId: here.project.id,
    runId: here.run.id,
    kind,
    severity,
    title: options.title,
    body: options.body,
    actions: options.actions,
    refs: options.refs,
    dedupeKey: options.dedupeKey,
  });
  return { card: result.card, deduped: result.deduped, project: projectShape(here.project, here.resolved) };
}

export interface AskOptions {
  question: string;
  title?: string;
  choices?: Array<{ id: string; label: string; style?: "primary" | "secondary" | "danger" }>;
  allowText?: boolean;
  timeoutS?: number;
  dedupeKey?: string;
  refs?: Record<string, unknown>;
}

function choiceId(label: string, index: number): string {
  const id = label
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return id || `choice-${index + 1}`;
}

/** A question card, then a bounded wait for the answer. */
export async function askHuman(ctx: AgentContext, options: AskOptions) {
  const question = options.question.trim();
  if (!question) throw new MusterError("missing_question", "ask_human needs a question.");
  const actions = (options.choices ?? []).slice(0, 9).map((choice, index) => ({
    id: choice.id?.trim() || choiceId(choice.label, index),
    label: choice.label.trim(),
    style: choice.style ?? ("secondary" as const),
    confirm: choice.style === "danger",
  }));
  const posted = postCardFor(ctx, {
    title: options.title?.trim() || question.split(/\r?\n/)[0]?.slice(0, 200) || "Question",
    kind: "question",
    body: question,
    severity: "attention",
    actions,
    refs: options.refs,
    dedupeKey: options.dedupeKey,
  });
  const timeoutS = Math.max(0, Math.min(options.timeoutS ?? 25, 120));
  const card = timeoutS === 0 ? posted.card : await waitForAnswer(posted.card.id, timeoutS * 1000);
  return answerShape(card);
}

async function waitForAnswer(id: string, timeoutMs: number): Promise<Card> {
  const db = getDb();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const card = getCard(db, id);
    if (!card) throw new MusterError("card_not_found", `No card ${id}`);
    if (["answered", "resolved", "dismissed", "expired"].includes(card.state)) return card;
    const left = deadline - Date.now();
    if (left <= 0) return card;
    await Bun.sleep(Math.min(400, Math.max(25, left)));
  }
}

function answerShape(card: Card) {
  const state =
    card.state === "answered" || card.state === "resolved"
      ? "answered"
      : card.state === "dismissed"
        ? "dismissed"
        : card.state === "expired"
          ? "expired"
          : "pending";
  const hint =
    state === "pending"
      ? "The person has not answered yet. Do not invent an answer. Continue other work and call muster_await_card later."
      : state === "dismissed"
        ? "The person dismissed the question. Do not assume an answer; ask again with more context or take the safe default and report it."
        : state === "expired"
          ? "The question expired. Ask again if it still matters."
          : "";
  return { state, card, answer: card.answer ?? null, ...(hint ? { hint } : {}) };
}

/** Wait for an existing card to be answered, without creating one. */
export async function awaitCard(id: string, timeoutS = 25) {
  const timeoutMs = Math.max(0, Math.min(timeoutS, 120)) * 1000;
  const card = await waitForAnswer(id, timeoutMs);
  return answerShape(card);
}

export interface ListCardsOptions {
  projectKey?: string;
  path?: string;
  states?: CardState[];
  kind?: CardKind;
  limit?: number;
  all?: boolean;
}

export function listCardsFor(options: ListCardsOptions = {}) {
  const db = getDb();
  let projectId: string | undefined;
  if (options.projectKey) {
    const project = getProject(db, options.projectKey);
    if (!project) throw new MusterError("project_not_found", `No project ${options.projectKey}`);
    projectId = project.id;
  } else if (options.path) {
    projectId = ensureProject(db, resolveProject(options.path)).id;
  }
  return listCards(db, {
    projectId,
    states: options.states,
    kind: options.kind,
    limit: options.limit,
    includeClosed:
      options.all || Boolean(options.states?.some((state) => ["resolved", "dismissed", "expired"].includes(state))),
  });
}

export function showCard(id: string) {
  const db = getDb();
  const card = getCard(db, id);
  if (!card) throw new MusterError("card_not_found", `No card ${id}`);
  return { card, artifacts: listArtifacts(db, { cardId: id }), events: listEvents(db, { cardId: id, limit: 20 }) };
}

export function answerCardById(
  id: string,
  answer: CardAnswer,
  options: { actor?: string; expectedVersion?: number } = {},
) {
  return answerCard(getDb(), id, answer, options);
}

export function claimCardById(id: string, actor?: string) {
  return claimCard(getDb(), id, actor);
}

export function resolveCardById(id: string, resolution?: string, actor?: string) {
  return resolveCard(getDb(), id, resolution, actor);
}

export function dismissCardById(id: string, actor?: string) {
  return dismissCard(getDb(), id, actor);
}

export function addArtifactFor(ctx: AgentContext, input: Omit<AddArtifactInput, "projectId" | "runId">) {
  const here = live(ctx);
  return addArtifact(getDb(), { ...input, projectId: here.project.id, runId: here.run.id });
}

function projectFor(options: { projectKey?: string; path?: string }): Project {
  const db = getDb();
  if (options.projectKey) {
    const project = getProject(db, options.projectKey);
    if (!project) throw new MusterError("project_not_found", `No project ${options.projectKey}`);
    return project;
  }
  return ensureProject(db, resolveProject(options.path ?? process.cwd()));
}

function ensureMarkerRunbook(project: Project): void {
  const db = getDb();
  const marker = project.marker as { runbook?: string } | null;
  if (!marker?.runbook) return;
  const existing = listRunbooks(db, project.id);
  if (existing.length > 0) return;
  try {
    importRunbook(db, project, marker.runbook);
  } catch {
    // A missing runbook file surfaces as an empty list, not a failed call.
  }
}

export function runbookGet(options: { projectKey?: string; path?: string; slug?: string } = {}) {
  const db = getDb();
  const project = projectFor(options);
  ensureMarkerRunbook(project);
  const books = listRunbooks(db, project.id);
  const runbooks = options.slug ? books.filter((book) => book.slug === options.slug) : books;
  return { project: projectShape(project), runbooks };
}

export function importRunbookFor(options: { projectKey?: string; path?: string; file: string; slug?: string; title?: string }) {
  const db = getDb();
  const project = projectFor(options);
  return importRunbook(db, project, options.file, { slug: options.slug, title: options.title });
}

export function runbookStep(options: {
  projectKey?: string;
  path?: string;
  slug: string;
  n: number;
  state: StepState;
  note?: string;
  runId?: string | null;
}) {
  const project = projectFor(options);
  return setRunbookStep(getDb(), {
    projectKey: project.key,
    slug: options.slug,
    n: options.n,
    state: options.state,
    note: options.note,
    runId: options.runId,
  });
}

export function logEventFor(ctx: AgentContext, kind: string, payload: Record<string, unknown> = {}) {
  const db = getDb();
  const here = live(ctx);
  db.query("INSERT INTO events (at, kind, project_id, run_id, card_id, payload) VALUES (?, ?, ?, ?, NULL, ?)").run(
    new Date().toISOString(),
    kind.slice(0, 80),
    here.project.id,
    here.run.id,
    JSON.stringify(payload),
  );
  return { ok: true, kind, project: projectShape(here.project) };
}

export function boardView(options: { days?: number } = {}) {
  return board(getDb(), options);
}

export function statsView(options: { days?: number } = {}) {
  return buildStats(getDb(), options);
}

export function snapshotView(options: { days?: number } = {}): Snapshot {
  return snapshot(getDb(), options);
}

export function eventsView(options: { projectKey?: string; cardId?: string; limit?: number } = {}) {
  const db = getDb();
  const projectId = options.projectKey ? projectFor({ projectKey: options.projectKey }).id : undefined;
  return listEvents(db, { projectId, cardId: options.cardId, limit: options.limit });
}

export function runsView(options: { projectKey?: string; live?: boolean } = {}) {
  const db = getDb();
  const projectId = options.projectKey ? projectFor({ projectKey: options.projectKey }).id : undefined;
  return listRuns(db, { projectId, live: options.live ?? true });
}

export interface DoctorReport {
  ok: boolean;
  version: string;
  platform: string;
  bun: string;
  home: string;
  db: string;
  dbExists: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

/** Read-only checks the install view and `muster doctor` show. */
export function doctor(): DoctorReport {
  const home = musterHome();
  const db = databasePath();
  const checks: DoctorReport["checks"] = [];

  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
  checks.push({ name: "bun", ok: Boolean(bunVersion), detail: bunVersion });

  const git = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  checks.push({
    name: "git",
    ok: git.status === 0,
    detail: git.status === 0 ? (git.stdout ?? "").trim() : "git not found on PATH",
  });

  checks.push({ name: "data folder", ok: existsSync(home), detail: home });
  const exists = existsSync(db);
  checks.push({ name: "database", ok: true, detail: exists ? db : `${db} (will be created)` });

  const project = resolveProject(process.cwd());
  checks.push({
    name: "project",
    ok: true,
    detail: `${project.name} · ${project.key} · ${project.source}`,
  });
  checks.push({
    name: "marker",
    ok: Boolean(project.markerPath),
    detail: project.markerPath ?? "none (inference is enough until you need an override)",
  });

  return {
    ok: checks.filter((check) => check.name !== "marker").every((check) => check.ok),
    version: MUSTER_VERSION,
    platform: process.platform,
    bun: bunVersion,
    home,
    db,
    dbExists: exists,
    checks,
  };
}

export { MusterError };
export type { Card, CardState, Project, Run, Snapshot, Stats };
