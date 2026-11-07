// The rows and the queries Muster builds from them: projects, runs, cards,
// events, artifacts and runbook progress. Cards are the durable interaction
// unit; runs are an agent's ephemeral session; events are the append-only log
// that stats and the activity feed read.

import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { databasePath, machineName, musterHome } from "./paths.ts";
import type { ResolvedProject } from "./projects.ts";
import { parseRunbook, runbookSlug } from "./runbook.ts";
import { dayKey, median, newId, nowIso, parseJson, percentile, secondsBetween, text } from "./util.ts";
import { MUSTER_VERSION } from "./version.ts";

export class MusterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MusterError";
    this.code = code;
  }
}

export const RUN_STATES = ["working", "blocked", "waiting", "done", "failed", "idle"] as const;
export type RunState = (typeof RUN_STATES)[number];

export const CARD_STATES = ["open", "claimed", "answered", "resolved", "dismissed", "expired"] as const;
export type CardState = (typeof CARD_STATES)[number];

export const CARD_KINDS = ["question", "approval", "report", "result", "progress"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_SEVERITIES = ["info", "attention", "blocked", "success"] as const;
export type CardSeverity = (typeof CARD_SEVERITIES)[number];

export const STEP_STATES = ["todo", "doing", "done", "blocked", "skipped"] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface CardAction {
  id: string;
  label: string;
  style: "primary" | "secondary" | "danger";
  confirm: boolean | string;
  payload?: unknown;
}

export interface CardAnswer {
  actionId?: string;
  text?: string;
  values?: unknown;
  note?: string;
  by?: string;
}

interface ProjectRow {
  id: string;
  key: string;
  name: string;
  color: string;
  root: string;
  remote: string | null;
  marker: string | null;
  source: string;
  created_at: string;
  seen_at: string;
}

interface RunRow {
  id: string;
  project_id: string;
  run_key: string;
  agent: string | null;
  terminal: string | null;
  cwd: string;
  branch: string | null;
  worktree: string | null;
  machine: string | null;
  state: string;
  summary: string | null;
  started_at: string;
  heartbeat_at: string;
  ended_at: string | null;
}

interface CardRow {
  id: string;
  project_id: string;
  run_id: string | null;
  kind: string;
  title: string;
  body: string;
  severity: string;
  state: string;
  actions_json: string;
  refs_json: string;
  answer_json: string | null;
  dedupe_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
  project_key?: string;
  project_name?: string;
  project_color?: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  color: string;
  root: string;
  remote: string | null;
  marker: Record<string, unknown> | null;
  source: string;
  createdAt: string;
  seenAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  agent: string | null;
  terminal: string | null;
  cwd: string;
  branch: string | null;
  worktree: string | null;
  machine: string | null;
  state: RunState;
  summary: string | null;
  startedAt: string;
  heartbeatAt: string;
  endedAt: string | null;
}

export interface Card {
  id: string;
  projectId: string;
  runId: string | null;
  kind: CardKind;
  title: string;
  body: string;
  severity: CardSeverity;
  state: CardState;
  actions: CardAction[];
  refs: Record<string, unknown>;
  answer: CardAnswer | null;
  dedupeKey: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  project?: { key: string; name: string; color: string };
}

export interface MusterEvent {
  id: number;
  at: string;
  kind: string;
  projectId: string | null;
  runId: string | null;
  cardId: string | null;
  payload: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  projectId: string;
  runId: string | null;
  cardId: string | null;
  kind: "file" | "url";
  title: string;
  path: string | null;
  url: string | null;
  mime: string | null;
  createdAt: string;
}

export interface RunbookStep {
  n: number;
  title: string;
  command: string | null;
  state: StepState;
  ownerRun: string | null;
  note: string | null;
  updatedAt: string;
}

export interface RunbookView {
  projectKey: string;
  projectName: string;
  color: string;
  slug: string;
  title: string;
  sourcePath: string | null;
  updatedAt: string;
  steps: RunbookStep[];
}

export interface BoardNext {
  kind: "answer" | "unblock" | "review" | "clear";
  label: string;
  cardId?: string;
  runId?: string;
}

export interface BoardProject {
  id: string;
  key: string;
  name: string;
  color: string;
  root: string;
  source: string;
  branch: string | null;
  /** The marker's runbook path, relative to the project root. */
  runbook: string | null;
  liveRuns: number;
  openCards: number;
  needs: number;
  answeredWindow: number;
  lastAt: string | null;
  next: BoardNext;
}

export interface Stats {
  windowDays: number;
  generatedAt: string;
  totals: {
    projects: number;
    runsLive: number;
    runsTotal: number;
    agentsWorking: number;
    agentsBlocked: number;
    cardsOpen: number;
    cardsNeeds: number;
    cardsAnswered: number;
  };
  cards: {
    byState: Record<string, number>;
    byKind: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  response: {
    answered: number;
    medianSeconds: number | null;
    p90Seconds: number | null;
  };
  activity: Array<{ date: string; count: number }>;
  projects: Array<{
    key: string;
    name: string;
    color: string;
    open: number;
    needs: number;
    liveRuns: number;
    answered: number;
    lastAt: string | null;
  }>;
}

export interface Snapshot {
  at: string;
  version: 1;
  musterVersion: string;
  home: string;
  db: string;
  board: BoardProject[];
  cards: Card[];
  runs: Run[];
  artifacts: Artifact[];
  events: MusterEvent[];
  stats: Stats;
  runbooks: RunbookView[];
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    color: row.color,
    root: row.root,
    remote: row.remote,
    marker: parseJson<Record<string, unknown> | null>(row.marker, null),
    source: row.source,
    createdAt: row.created_at,
    seenAt: row.seen_at,
  };
}

function runFromRow(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    agent: row.agent,
    terminal: row.terminal,
    cwd: row.cwd,
    branch: row.branch,
    worktree: row.worktree,
    machine: row.machine,
    state: (RUN_STATES as readonly string[]).includes(row.state) ? (row.state as RunState) : "idle",
    summary: row.summary,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    endedAt: row.ended_at,
  };
}

function cardFromRow(row: CardRow): Card {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    kind: (CARD_KINDS as readonly string[]).includes(row.kind) ? (row.kind as CardKind) : "report",
    title: row.title,
    body: row.body,
    severity: (CARD_SEVERITIES as readonly string[]).includes(row.severity)
      ? (row.severity as CardSeverity)
      : "info",
    state: (CARD_STATES as readonly string[]).includes(row.state) ? (row.state as CardState) : "open",
    actions: parseJson<CardAction[]>(row.actions_json, []),
    refs: parseJson<Record<string, unknown>>(row.refs_json, {}),
    answer: row.answer_json ? parseJson<CardAnswer | null>(row.answer_json, null) : null,
    dedupeKey: row.dedupe_key,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answeredAt: row.answered_at,
    ...(row.project_key
      ? { project: { key: row.project_key, name: row.project_name ?? "", color: row.project_color ?? "#a8b79a" } }
      : {}),
  };
}

/** Insert or refresh a project resolved from a folder. */
export function ensureProject(db: Database, ref: ResolvedProject): Project {
  const now = nowIso();
  db.query(
    `INSERT INTO projects (id, key, name, color, root, remote, marker, source, created_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       root = excluded.root,
       remote = excluded.remote,
       marker = excluded.marker,
       source = excluded.source,
       seen_at = excluded.seen_at`,
  ).run(
    newId("prj"),
    ref.key,
    ref.name,
    ref.color,
    ref.root,
    ref.remote,
    ref.marker ? JSON.stringify(ref.marker) : null,
    ref.source,
    now,
    now,
  );
  const row = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE key = ?").get(ref.key);
  if (!row) throw new MusterError("project_failed", `Could not store project ${ref.key}`);
  return projectFromRow(row);
}

/** Look up a project by key. */
export function getProject(db: Database, key: string): Project | null {
  const row = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE key = ?").get(key);
  return row ? projectFromRow(row) : null;
}

/** Every project Muster has seen, newest activity first. */
export function listProjects(db: Database): Project[] {
  return db
    .query<ProjectRow, []>("SELECT * FROM projects ORDER BY seen_at DESC")
    .all()
    .map(projectFromRow);
}

function runKey(projectId: string, info: RunInfo): string {
  if (info.terminal) return `${projectId}|terminal:${info.terminal}`;
  if (info.agent) return `${projectId}|agent:${info.agent}|${info.cwd}`;
  return `${projectId}|cwd:${info.cwd}`;
}

export interface RunInfo {
  agent?: string | null;
  terminal?: string | null;
  cwd: string;
  branch?: string | null;
  worktree?: string | null;
  state?: RunState;
}

/** Find the agent's live run for this project, or start one. */
export function ensureRun(db: Database, projectId: string, info: RunInfo): Run {
  const now = nowIso();
  const key = runKey(projectId, info);
  const open = db
    .query<RunRow, [string]>("SELECT * FROM runs WHERE run_key = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .get(key);

  if (open) {
    db.query(
      `UPDATE runs SET
         agent = COALESCE(?, agent),
         terminal = COALESCE(?, terminal),
         cwd = ?,
         branch = COALESCE(?, branch),
         worktree = COALESCE(?, worktree),
         machine = ?,
         heartbeat_at = ?
       WHERE id = ?`,
    ).run(
      info.agent ?? null,
      info.terminal ?? null,
      info.cwd,
      info.branch ?? null,
      info.worktree ?? null,
      machineName(),
      now,
      open.id,
    );
    return runFromRow(db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(open.id) ?? open);
  }

  const id = newId("run");
  db.query(
    `INSERT INTO runs (id, project_id, run_key, agent, terminal, cwd, branch, worktree, machine, state, summary, started_at, heartbeat_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
  ).run(
    id,
    projectId,
    key,
    info.agent ?? null,
    info.terminal ?? null,
    info.cwd,
    info.branch ?? null,
    info.worktree ?? null,
    machineName(),
    info.state ?? "working",
    now,
    now,
  );
  return runFromRow(db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id) as RunRow);
}

/** Read a run by id. */
export function getRun(db: Database, id: string): Run | null {
  const row = db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
  return row ? runFromRow(row) : null;
}

/** Live runs, optionally for one project. */
export function listRuns(db: Database, options: { projectId?: string; live?: boolean; limit?: number } = {}): Run[] {
  const where: string[] = [];
  const params: string[] = [];
  if (options.projectId) {
    where.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.live !== false) where.push("ended_at IS NULL");
  const sql = `SELECT * FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY heartbeat_at DESC LIMIT ${Math.max(1, Math.min(options.limit ?? 100, 500))}`;
  return db.query<RunRow, string[]>(sql).all(...params).map(runFromRow);
}

/** Change a run's state and summary; done and failed end the run. */
export function setRunState(db: Database, runId: string, state: RunState, summary?: string | null): Run {
  if (!(RUN_STATES as readonly string[]).includes(state)) {
    throw new MusterError("bad_state", `Unknown run state: ${state}`);
  }
  const run = getRun(db, runId);
  if (!run) throw new MusterError("run_not_found", `No run ${runId}`);
  const now = nowIso();
  const ended = state === "done" || state === "failed" ? now : null;
  db.query(
    "UPDATE runs SET state = ?, summary = COALESCE(?, summary), heartbeat_at = ?, ended_at = ? WHERE id = ?",
  ).run(state, summary?.trim() || null, now, ended, runId);
  addEvent(db, {
    kind: "run.state",
    projectId: run.projectId,
    runId,
    payload: { state, summary: summary?.trim() || run.summary || "" },
  });
  return (getRun(db, runId) as Run);
}

export interface PostCardInput {
  projectId: string;
  runId?: string | null;
  kind?: CardKind;
  title: string;
  body?: string;
  severity?: CardSeverity;
  actions?: Array<Partial<CardAction> & { id: string; label: string }>;
  refs?: Record<string, unknown>;
  dedupeKey?: string | null;
}

function cleanActions(actions: PostCardInput["actions"]): CardAction[] {
  return (actions ?? [])
    .filter((action) => action && typeof action.id === "string" && typeof action.label === "string")
    .slice(0, 12)
    .map((action) => ({
      id: text(action.id, 80),
      label: text(action.label, 160),
      style: action.style === "primary" || action.style === "danger" ? action.style : "secondary",
      confirm: typeof action.confirm === "string" ? text(action.confirm, 200) : Boolean(action.confirm),
      ...(action.payload === undefined ? {} : { payload: action.payload }),
    }));
}

/** Open a card, or return the live card with the same dedupe key. */
export function postCard(db: Database, input: PostCardInput): { card: Card; deduped: boolean } {
  const title = text(input.title, 300);
  if (!title) throw new MusterError("missing_title", "A card needs a title.");
  const kindInput = input.kind ?? "report";
  const kind: CardKind = (CARD_KINDS as readonly string[]).includes(kindInput) ? kindInput : "report";
  const severityInput = input.severity ?? "info";
  const severity: CardSeverity = (CARD_SEVERITIES as readonly string[]).includes(severityInput)
    ? severityInput
    : "info";
  const dedupeKey = input.dedupeKey?.trim() ? text(input.dedupeKey, 200) : null;

  if (dedupeKey) {
    const existing = db
      .query<CardRow, [string, string]>(
        `SELECT * FROM cards
         WHERE project_id = ? AND dedupe_key = ? AND state IN ('open', 'claimed', 'answered')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(input.projectId, dedupeKey);
    if (existing) return { card: cardFromRow(existing), deduped: true };
  }

  const now = nowIso();
  const id = newId("card");
  db.query(
    `INSERT INTO cards (id, project_id, run_id, kind, title, body, severity, state, actions_json, refs_json, answer_json, dedupe_key, version, created_at, updated_at, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?, 1, ?, ?, NULL)`,
  ).run(
    id,
    input.projectId,
    input.runId ?? null,
    kind,
    title,
    text(input.body, 20_000),
    severity,
    JSON.stringify(cleanActions(input.actions)),
    JSON.stringify(input.refs ?? {}),
    dedupeKey,
    now,
    now,
  );
  addEvent(db, {
    kind: "card.posted",
    projectId: input.projectId,
    runId: input.runId ?? null,
    cardId: id,
    payload: { title, kind, severity },
  });
  return { card: getCard(db, id) as Card, deduped: false };
}

/** One card, with its project summary when known. */
export function getCard(db: Database, id: string): Card | null {
  const row = db
    .query<CardRow, [string]>(
      `SELECT c.*, p.key AS project_key, p.name AS project_name, p.color AS project_color
       FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.id = ?`,
    )
    .get(id);
  return row ? cardFromRow(row) : null;
}

export interface CardFilter {
  projectId?: string;
  projectKey?: string;
  states?: CardState[];
  kind?: CardKind;
  limit?: number;
  includeClosed?: boolean;
}

/** Cards in attention order: blocked, then waiting, then the rest. */
export function listCards(db: Database, filter: CardFilter = {}): Card[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.projectId) {
    where.push("c.project_id = ?");
    params.push(filter.projectId);
  } else if (filter.projectKey) {
    where.push("p.key = ?");
    params.push(filter.projectKey);
  }
  if (filter.states?.length) {
    where.push(`c.state IN (${filter.states.map(() => "?").join(", ")})`);
    params.push(...filter.states);
  } else if (!filter.includeClosed) {
    where.push("c.state IN ('open', 'claimed', 'answered')");
  }
  if (filter.kind) {
    where.push("c.kind = ?");
    params.push(filter.kind);
  }
  const sql = `SELECT c.*, p.key AS project_key, p.name AS project_name, p.color AS project_color
    FROM cards c JOIN projects p ON p.id = c.project_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      CASE c.severity WHEN 'blocked' THEN 0 WHEN 'attention' THEN 1 WHEN 'info' THEN 2 ELSE 3 END,
      CASE c.state WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END,
      c.updated_at DESC
    LIMIT ${Math.max(1, Math.min(filter.limit ?? 100, 500))}`;
  return db.query<CardRow, string[]>(sql).all(...params).map(cardFromRow);
}

/** Claim a card, the way a UI or a worker says "I am handling this". */
export function claimCard(db: Database, id: string, actor = "human"): Card {
  const card = getCard(db, id);
  if (!card) throw new MusterError("card_not_found", `No card ${id}`);
  if (card.state !== "open") return card;
  db.query("UPDATE cards SET state = 'claimed', version = version + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
  addEvent(db, { kind: "card.claimed", projectId: card.projectId, cardId: id, payload: { by: actor } });
  return getCard(db, id) as Card;
}

/** Answer a card. Answered cards can be revised until they are resolved. */
export function answerCard(
  db: Database,
  id: string,
  answer: CardAnswer,
  options: { actor?: string; expectedVersion?: number } = {},
): Card {
  const card = getCard(db, id);
  if (!card) throw new MusterError("card_not_found", `No card ${id}`);
  if (["resolved", "dismissed", "expired"].includes(card.state)) {
    throw new MusterError("card_closed", `Card ${id} is already ${card.state}.`);
  }
  if (options.expectedVersion !== undefined && options.expectedVersion !== card.version) {
    throw new MusterError("card_changed", `Card ${id} changed since version ${options.expectedVersion}.`);
  }
  const now = nowIso();
  const stored: CardAnswer = {
    ...answer,
    ...(answer.actionId ? { actionId: text(answer.actionId, 80) } : {}),
    ...(answer.text ? { text: text(answer.text, 20_000) } : {}),
    ...(answer.note ? { note: text(answer.note, 4_000) } : {}),
    by: options.actor ?? answer.by ?? "human",
  };
  db.query(
    `UPDATE cards SET state = 'answered', answer_json = ?, answered_at = ?, updated_at = ?, version = version + 1
     WHERE id = ?`,
  ).run(JSON.stringify(stored), now, now, id);
  addEvent(db, {
    kind: "card.answered",
    projectId: card.projectId,
    runId: card.runId,
    cardId: id,
    payload: { actionId: stored.actionId ?? null, text: stored.text ?? null, by: stored.by },
  });
  return getCard(db, id) as Card;
}

/** Close a card for good. */
export function resolveCard(db: Database, id: string, resolution?: string, actor = "human"): Card {
  const card = getCard(db, id);
  if (!card) throw new MusterError("card_not_found", `No card ${id}`);
  if (card.state === "resolved") return card;
  const now = nowIso();
  db.query(
    "UPDATE cards SET state = 'resolved', version = version + 1, updated_at = ?, answered_at = COALESCE(answered_at, ?) WHERE id = ?",
  ).run(now, now, id);
  addEvent(db, {
    kind: "card.resolved",
    projectId: card.projectId,
    runId: card.runId,
    cardId: id,
    payload: { resolution: text(resolution, 4_000), by: actor },
  });
  return getCard(db, id) as Card;
}

/** Put a card away without answering it. */
export function dismissCard(db: Database, id: string, actor = "human"): Card {
  const card = getCard(db, id);
  if (!card) throw new MusterError("card_not_found", `No card ${id}`);
  if (card.state === "dismissed") return card;
  db.query("UPDATE cards SET state = 'dismissed', version = version + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
  addEvent(db, { kind: "card.dismissed", projectId: card.projectId, runId: card.runId, cardId: id, payload: { by: actor } });
  return getCard(db, id) as Card;
}

export interface EventInput {
  kind: string;
  projectId?: string | null;
  runId?: string | null;
  cardId?: string | null;
  payload?: Record<string, unknown>;
}

/** Append an event to the log. */
export function addEvent(db: Database, event: EventInput): void {
  db.query("INSERT INTO events (at, kind, project_id, run_id, card_id, payload) VALUES (?, ?, ?, ?, ?, ?)").run(
    nowIso(),
    text(event.kind, 80),
    event.projectId ?? null,
    event.runId ?? null,
    event.cardId ?? null,
    JSON.stringify(event.payload ?? {}),
  );
}

interface EventRow {
  id: number;
  at: string;
  kind: string;
  project_id: string | null;
  run_id: string | null;
  card_id: string | null;
  payload: string;
}

/** Recent events, newest first. */
export function listEvents(
  db: Database,
  options: { projectId?: string; cardId?: string; limit?: number; since?: string } = {},
): MusterEvent[] {
  const where: string[] = [];
  const params: string[] = [];
  if (options.projectId) {
    where.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.cardId) {
    where.push("card_id = ?");
    params.push(options.cardId);
  }
  if (options.since) {
    where.push("at >= ?");
    params.push(options.since);
  }
  const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY at DESC, id DESC LIMIT ${Math.max(1, Math.min(options.limit ?? 50, 500))}`;
  return db.query<EventRow, string[]>(sql).all(...params).map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    projectId: row.project_id,
    runId: row.run_id,
    cardId: row.card_id,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
  }));
}

export interface AddArtifactInput {
  projectId: string;
  runId?: string | null;
  cardId?: string | null;
  title?: string;
  path?: string;
  url?: string;
  mime?: string;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Attach a file or a link to a run and/or card. */
export function addArtifact(db: Database, input: AddArtifactInput): Artifact {
  let kind: "file" | "url";
  let path: string | null = null;
  let url: string | null = null;

  if (input.url) {
    if (!isUrl(input.url)) throw new MusterError("bad_url", "Artifact URLs must be http or https.");
    kind = "url";
    url = input.url;
  } else if (input.path) {
    path = isAbsolute(input.path) ? input.path : resolve(process.cwd(), input.path);
    if (!existsSync(path)) throw new MusterError("artifact_missing", `No file at ${path}`);
    if (!statSync(path).isFile()) throw new MusterError("artifact_missing", `${path} is not a file.`);
    kind = "file";
  } else {
    throw new MusterError("artifact_empty", "An artifact needs a path or a url.");
  }

  const now = nowIso();
  const id = newId("art");
  const title = text(input.title, 300) || (url ? (new URL(url).pathname.split("/").pop() ?? url) : (path?.split(/[\\/]/).pop() ?? ""));
  db.query(
    `INSERT INTO artifacts (id, project_id, run_id, card_id, kind, title, path, url, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.runId ?? null, input.cardId ?? null, kind, title, path, url, input.mime ?? null, now);

  addEvent(db, {
    kind: "artifact.added",
    projectId: input.projectId,
    runId: input.runId ?? null,
    cardId: input.cardId ?? null,
    payload: { title, kind },
  });

  return {
    id,
    projectId: input.projectId,
    runId: input.runId ?? null,
    cardId: input.cardId ?? null,
    kind,
    title,
    path,
    url,
    mime: input.mime ?? null,
    createdAt: now,
  };
}

interface ArtifactRow {
  id: string;
  project_id: string;
  run_id: string | null;
  card_id: string | null;
  kind: string;
  title: string;
  path: string | null;
  url: string | null;
  mime: string | null;
  created_at: string;
}

/** Artifacts for a card, or the latest for a project. */
export function listArtifacts(db: Database, options: { cardId?: string; projectId?: string; limit?: number }): Artifact[] {
  const where: string[] = [];
  const params: string[] = [];
  if (options.cardId) {
    where.push("card_id = ?");
    params.push(options.cardId);
  }
  if (options.projectId) {
    where.push("project_id = ?");
    params.push(options.projectId);
  }
  const sql = `SELECT * FROM artifacts ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(options.limit ?? 50, 200))}`;
  return db.query<ArtifactRow, string[]>(sql).all(...params).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    cardId: row.card_id,
    kind: row.kind === "url" ? "url" : "file",
    title: row.title,
    path: row.path,
    url: row.url,
    mime: row.mime,
    createdAt: row.created_at,
  }));
}

function needsCard(db: Database, projectId: string): { id: string; title: string; kind: string } | null {
  return (
    db
      .query<{ id: string; title: string; kind: string }, [string]>(
        `SELECT id, title, kind FROM cards
         WHERE project_id = ? AND state IN ('open', 'claimed')
           AND (kind IN ('question', 'approval') OR severity IN ('blocked', 'attention'))
         ORDER BY CASE severity WHEN 'blocked' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
      )
      .get(projectId) ?? null
  );
}

function blockedRun(db: Database, projectId: string): { id: string; label: string } | null {
  const row = db
    .query<{ id: string; agent: string | null; terminal: string | null; summary: string | null }, [string]>(
      `SELECT id, agent, terminal, summary FROM runs
       WHERE project_id = ? AND ended_at IS NULL AND state = 'blocked'
       ORDER BY heartbeat_at DESC LIMIT 1`,
    )
    .get(projectId);
  if (!row) return null;
  return { id: row.id, label: row.summary || `${row.agent ?? row.terminal ?? "an agent"} is blocked` };
}

function nextFor(db: Database, projectId: string): BoardNext {
  const card = needsCard(db, projectId);
  if (card) {
    return {
      kind: card.kind === "question" || card.kind === "approval" ? "answer" : "review",
      label: card.title,
      cardId: card.id,
    };
  }
  const run = blockedRun(db, projectId);
  if (run) return { kind: "unblock", label: run.label, runId: run.id };
  const rest = db
    .query<{ id: string; title: string }, [string]>(
      "SELECT id, title FROM cards WHERE project_id = ? AND state IN ('open', 'claimed') ORDER BY created_at ASC LIMIT 1",
    )
    .get(projectId);
  if (rest) return { kind: "review", label: rest.title, cardId: rest.id };
  return { kind: "clear", label: "Nothing needs you" };
}

interface BoardRow {
  id: string;
  key: string;
  name: string;
  color: string;
  root: string;
  source: string;
  marker: string | null;
  branch: string | null;
  live_runs: number;
  open_cards: number;
  needs: number;
  answered_window: number;
  last_at: string | null;
}

/** The project rollup: what is live, what waits, and the next move. */
export function board(db: Database, options: { days?: number } = {}): BoardProject[] {
  const since = new Date(Date.now() - (options.days ?? 7) * 86_400_000).toISOString();
  const rows = db
    .query<BoardRow, [string]>(
      `SELECT p.id, p.key, p.name, p.color, p.root, p.source, p.marker,
         (SELECT r.branch FROM runs r WHERE r.project_id = p.id AND r.ended_at IS NULL
            ORDER BY r.heartbeat_at DESC LIMIT 1) AS branch,
         (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id AND r.ended_at IS NULL) AS live_runs,
         (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.state IN ('open', 'claimed')) AS open_cards,
         (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.state IN ('open', 'claimed')
            AND (c.kind IN ('question', 'approval') OR c.severity IN ('blocked', 'attention'))) AS needs,
         (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.state = 'answered'
            AND c.answered_at >= ?) AS answered_window,
         (SELECT MAX(e.at) FROM events e WHERE e.project_id = p.id) AS last_at
       FROM projects p
       ORDER BY needs DESC, live_runs DESC, last_at DESC`,
    )
    .all(since);

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    color: row.color,
    root: row.root,
    source: row.source,
    branch: row.branch,
    runbook: parseJson<{ runbook?: string } | null>(row.marker, null)?.runbook ?? null,
    liveRuns: row.live_runs,
    openCards: row.open_cards,
    needs: row.needs,
    answeredWindow: row.answered_window,
    lastAt: row.last_at,
    next: nextFor(db, row.id),
  }));
}

/** Counts, response times and a day-by-day activity series. */
export function stats(db: Database, options: { days?: number } = {}): Stats {
  const days = Math.max(1, Math.min(options.days ?? 14, 90));
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const sinceIso = `${since}T00:00:00.000Z`;

  const byState: Record<string, number> = {};
  for (const row of db.query<{ state: string; n: number }, []>("SELECT state, COUNT(*) AS n FROM cards GROUP BY state").all()) {
    byState[row.state] = row.n;
  }
  const byKind: Record<string, number> = {};
  for (const row of db.query<{ kind: string; n: number }, []>("SELECT kind, COUNT(*) AS n FROM cards GROUP BY kind").all()) {
    byKind[row.kind] = row.n;
  }
  const bySeverity: Record<string, number> = {};
  for (const row of db
    .query<{ severity: string; n: number }, []>("SELECT severity, COUNT(*) AS n FROM cards GROUP BY severity")
    .all()) {
    bySeverity[row.severity] = row.n;
  }

  const answered = db
    .query<{ created_at: string; answered_at: string | null }, [string]>(
      "SELECT created_at, answered_at FROM cards WHERE answered_at >= ?",
    )
    .all(sinceIso);
  const responseSeconds = answered
    .map((row) => secondsBetween(row.created_at, row.answered_at))
    .filter((value): value is number => value !== null);

  const activityRows = db
    .query<{ date: string; n: number }, [string]>(
      "SELECT substr(at, 1, 10) AS date, COUNT(*) AS n FROM events WHERE at >= ? GROUP BY date",
    )
    .all(sinceIso);
  const activityMap = new Map(activityRows.map((row) => [row.date, row.n]));
  const activity: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayKey(new Date(Date.now() - i * 86_400_000).toISOString());
    activity.push({ date, count: activityMap.get(date) ?? 0 });
  }

  const totals = db
    .query<
      {
        projects: number;
        runs_live: number;
        runs_total: number;
        agents_working: number;
        agents_blocked: number;
      },
      []
    >(
      `SELECT
         (SELECT COUNT(*) FROM projects) AS projects,
         (SELECT COUNT(*) FROM runs WHERE ended_at IS NULL) AS runs_live,
         (SELECT COUNT(*) FROM runs) AS runs_total,
         (SELECT COUNT(*) FROM runs WHERE ended_at IS NULL AND state = 'working') AS agents_working,
         (SELECT COUNT(*) FROM runs WHERE ended_at IS NULL AND state = 'blocked') AS agents_blocked`,
    )
    .get();

  const open = (byState.open ?? 0) + (byState.claimed ?? 0);
  const needs =
    db
      .query<{ n: number }, []>(
        `SELECT COUNT(*) AS n FROM cards WHERE state IN ('open', 'claimed')
           AND (kind IN ('question', 'approval') OR severity IN ('blocked', 'attention'))`,
      )
      .get()?.n ?? 0;

  const projectRows = db
    .query<
      {
        key: string;
        name: string;
        color: string;
        open: number;
        needs: number;
        live_runs: number;
        answered: number;
        last_at: string | null;
      },
      [string]
    >(
      `SELECT p.key, p.name, p.color,
         (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.state IN ('open', 'claimed')) AS open,
         (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.state IN ('open', 'claimed')
            AND (c.kind IN ('question', 'approval') OR c.severity IN ('blocked', 'attention'))) AS needs,
         (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id AND r.ended_at IS NULL) AS live_runs,
         (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.state = 'answered'
            AND c.answered_at >= ?) AS answered,
         (SELECT MAX(e.at) FROM events e WHERE e.project_id = p.id) AS last_at
       FROM projects p ORDER BY needs DESC, open DESC, last_at DESC`,
    )
    .all(sinceIso);

  return {
    windowDays: days,
    generatedAt: nowIso(),
    totals: {
      projects: totals?.projects ?? 0,
      runsLive: totals?.runs_live ?? 0,
      runsTotal: totals?.runs_total ?? 0,
      agentsWorking: totals?.agents_working ?? 0,
      agentsBlocked: totals?.agents_blocked ?? 0,
      cardsOpen: open,
      cardsNeeds: needs,
      cardsAnswered: byState.answered ?? 0,
    },
    cards: { byState, byKind, bySeverity },
    response: {
      answered: responseSeconds.length,
      medianSeconds: median(responseSeconds),
      p90Seconds: percentile(responseSeconds, 0.9),
    },
    activity,
    projects: projectRows.map((row) => ({
      key: row.key,
      name: row.name,
      color: row.color,
      open: row.open,
      needs: row.needs,
      liveRuns: row.live_runs,
      answered: row.answered,
      lastAt: row.last_at,
    })),
  };
}

function getRunbook(db: Database, projectId: string, slug: string): RunbookView | null {
  const row = db
    .query<
      { project_key: string; project_name: string; color: string; slug: string; title: string; source_path: string | null; updated_at: string },
      [string, string]
    >(
      `SELECT p.key AS project_key, p.name AS project_name, p.color, r.slug, r.title, r.source_path, r.updated_at
       FROM runbooks r JOIN projects p ON p.id = r.project_id WHERE r.project_id = ? AND r.slug = ?`,
    )
    .get(projectId, slug);
  if (!row) return null;
  const steps = db
    .query<
      { n: number; title: string; command: string | null; state: string; owner_run: string | null; note: string | null; updated_at: string },
      [string, string]
    >("SELECT * FROM runbook_steps WHERE project_id = ? AND slug = ? ORDER BY n ASC")
    .all(projectId, slug)
    .map((step) => ({
      n: step.n,
      title: step.title,
      command: step.command,
      state: (STEP_STATES as readonly string[]).includes(step.state) ? (step.state as StepState) : "todo",
      ownerRun: step.owner_run,
      note: step.note,
      updatedAt: step.updated_at,
    }));
  return {
    projectKey: row.project_key,
    projectName: row.project_name,
    color: row.color,
    slug: row.slug,
    title: row.title,
    sourcePath: row.source_path,
    updatedAt: row.updated_at,
    steps,
  };
}

/** Import a markdown runbook, keeping the state of steps that already exist. */
export function importRunbook(
  db: Database,
  project: { id: string; root: string },
  filePath: string,
  options: { slug?: string; title?: string } = {},
): RunbookView {
  const absolute = isAbsolute(filePath) ? filePath : resolve(project.root, filePath);
  if (!existsSync(absolute)) throw new MusterError("runbook_missing", `No runbook at ${absolute}`);
  const markdown = readFileSync(absolute, "utf8");
  const parsed = parseRunbook(markdown, options.title ?? runbookSlug(absolute));
  const slug = options.slug?.trim() || runbookSlug(absolute);
  const title = options.title?.trim() || parsed.title;
  const now = nowIso();

  db.query(
    `INSERT INTO runbooks (project_id, slug, title, source_path, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, slug) DO UPDATE SET title = excluded.title, source_path = excluded.source_path, updated_at = excluded.updated_at`,
  ).run(project.id, slug, title, absolute, now);

  const upsert = db.query(
    `INSERT INTO runbook_steps (project_id, slug, n, title, command, state, owner_run, note, updated_at)
     VALUES (?, ?, ?, ?, ?, 'todo', NULL, NULL, ?)
     ON CONFLICT(project_id, slug, n) DO UPDATE SET
       title = excluded.title, command = excluded.command, updated_at = excluded.updated_at`,
  );
  for (const step of parsed.steps) {
    upsert.run(project.id, slug, step.n, step.title, step.command, now);
  }
  if (parsed.steps.length === 0) {
    db.query("DELETE FROM runbook_steps WHERE project_id = ? AND slug = ?").run(project.id, slug);
  } else {
    db.query("DELETE FROM runbook_steps WHERE project_id = ? AND slug = ? AND n > ?").run(
      project.id,
      slug,
      parsed.steps.length,
    );
  }
  addEvent(db, { kind: "runbook.imported", projectId: project.id, payload: { slug, steps: parsed.steps.length } });
  return getRunbook(db, project.id, slug) as RunbookView;
}

/** Runbooks for one project, or every project. */
export function listRunbooks(db: Database, projectId?: string): RunbookView[] {
  const rows = projectId
    ? db.query<{ project_id: string; slug: string }, [string]>("SELECT project_id, slug FROM runbooks WHERE project_id = ?").all(projectId)
    : db.query<{ project_id: string; slug: string }, []>("SELECT project_id, slug FROM runbooks").all();
  return rows
    .map((row) => getRunbook(db, row.project_id, row.slug))
    .filter((book): book is RunbookView => book !== null);
}

/** Import `.muster.json` runbooks that have no rows yet. */
export function autoImportRunbooks(db: Database): void {
  const rows = db
    .query<{ id: string; root: string; marker: string | null }, []>("SELECT id, root, marker FROM projects")
    .all();
  for (const row of rows) {
    const marker = parseJson<{ runbook?: string } | null>(row.marker, null);
    if (!marker?.runbook) continue;
    const existing = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM runbooks WHERE project_id = ?").get(row.id);
    if ((existing?.n ?? 0) > 0) continue;
    try {
      importRunbook(db, { id: row.id, root: row.root }, marker.runbook);
    } catch (error) {
      addEvent(db, {
        kind: "runbook.error",
        projectId: row.id,
        payload: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

/** Move a runbook step, recording who owns it and why. */
export function setRunbookStep(
  db: Database,
  options: { projectKey: string; slug: string; n: number; state: StepState; note?: string; runId?: string | null },
): RunbookView {
  const project = getProject(db, options.projectKey);
  if (!project) throw new MusterError("project_not_found", `No project ${options.projectKey}`);
  if (!(STEP_STATES as readonly string[]).includes(options.state)) {
    throw new MusterError("bad_state", `Unknown step state: ${options.state}`);
  }
  const step = db
    .query<{ n: number }, [string, string, number]>(
      "SELECT n FROM runbook_steps WHERE project_id = ? AND slug = ? AND n = ?",
    )
    .get(project.id, options.slug, options.n);
  if (!step) throw new MusterError("step_not_found", `No step ${options.n} in ${options.slug}`);
  db.query(
    "UPDATE runbook_steps SET state = ?, note = COALESCE(?, note), owner_run = COALESCE(?, owner_run), updated_at = ? WHERE project_id = ? AND slug = ? AND n = ?",
  ).run(options.state, options.note?.trim() || null, options.runId ?? null, nowIso(), project.id, options.slug, options.n);
  addEvent(db, {
    kind: "runbook.step",
    projectId: project.id,
    runId: options.runId ?? null,
    payload: { slug: options.slug, n: options.n, state: options.state, note: options.note?.trim() || "" },
  });
  return getRunbook(db, project.id, options.slug) as RunbookView;
}

/** Everything the UI needs in one read. */
export function snapshot(db: Database, options: { days?: number } = {}): Snapshot {
  autoImportRunbooks(db);
  return {
    at: nowIso(),
    version: 1,
    musterVersion: MUSTER_VERSION,
    home: musterHome(),
    db: databasePath(),
    board: board(db, options),
    cards: listCards(db, { limit: 60, includeClosed: true }),
    runs: listRuns(db, { limit: 25 }),
    artifacts: listArtifacts(db, { limit: 50 }),
    events: listEvents(db, { limit: 40 }),
    stats: stats(db, options),
    runbooks: listRunbooks(db),
  };
}
