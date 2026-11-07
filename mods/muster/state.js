// One snapshot shared by every Muster view. The mods run in Herdr's JS
// runtime, so the store is reached through the `muster` CLI; the config the
// installer writes (`{command, prefix, db?}`) says how to start it. A single
// global keeps every mounted block on the same snapshot and one in-flight
// process.

import { exec, appHome, readTextFile, shared, setShared, run } from "herdr";

const KEY = "__musterStore";
const CONFIG_KEY = "__musterConfig";
const SUCCESS_TTL = 2500;
const CONFIG_TTL = 5000;

function store() {
  return (globalThis[KEY] ??= {
    snapshot: null,
    error: null,
    at: 0,
    loading: false,
    inflight: null,
    listeners: new Set(),
  });
}

export function snapshot() {
  return store().snapshot;
}

export function lastError() {
  return store().error;
}

/** The install record: `{ command, prefix, db? }`, falling back to Bun beside the app home. */
export async function config() {
  const cached = globalThis[CONFIG_KEY];
  if (cached && Date.now() - cached.at < CONFIG_TTL) return cached.value;
  let value = null;
  try {
    const text = await readTextFile(`${appHome()}/muster.json`);
    if (text) value = JSON.parse(text);
  } catch {
    // fall back below
  }
  value ??= { command: "bun", prefix: [`${appHome()}/service/src/cli.ts`] };
  if (!value.command) value.command = "bun";
  if (!Array.isArray(value.prefix)) value.prefix = [];
  globalThis[CONFIG_KEY] = { at: Date.now(), value };
  return value;
}

/** Runs a `muster` subcommand and returns stdout. Throws with stderr on failure. */
export async function call(args, options = {}) {
  const cfg = await config();
  const full = cfg.db ? ["--db", cfg.db, ...args] : args;
  const r = await exec(cfg.command, [...cfg.prefix, ...full], options.cwd ? { cwd: options.cwd } : undefined);
  if (r?.code !== 0) {
    const detail = String(r?.stderr || r?.stdout || "").trim();
    throw new Error(detail || `muster exited ${r?.code ?? "?"}`);
  }
  return String(r?.stdout ?? "");
}

async function readSnapshot() {
  const text = await call(["snapshot", "--json"], { cwd: appHome() });
  return JSON.parse(text);
}

function settle() {
  const s = store();
  for (const entry of s.listeners) {
    try {
      entry.fn(entry.cx);
    } catch {
      // A view that is closing must not stop the others.
    }
  }
}

/** Reads a fresh snapshot, deduping concurrent callers. */
export function refresh(force = false) {
  const s = store();
  if (s.inflight) return s.inflight;
  if (!force && s.snapshot && Date.now() - s.at < SUCCESS_TTL) return Promise.resolve(s.snapshot);
  s.loading = true;
  s.inflight = readSnapshot()
    .then((value) => {
      s.snapshot = value;
      s.error = null;
      s.at = Date.now();
      return value;
    })
    .catch((error) => {
      s.error = String(error?.message ?? error);
      throw error;
    })
    .finally(() => {
      s.loading = false;
      s.inflight = null;
      settle();
    });
  return s.inflight;
}

/** Subscribes a view: one notify now and every refresh after. */
export function subscribe(cx, fn) {
  const s = store();
  const entry = { cx, fn };
  s.listeners.add(entry);
  cx.timer.every(3000, () => {
    refresh().catch(() => {});
  });
  refresh().catch(() => {});
  return {
    stop() {
      s.listeners.delete(entry);
    },
  };
}

/** The selected project key, or the first project the snapshot knows. */
export function selectedProject(snap = snapshot()) {
  const key = shared("muster.project");
  if (key && snap?.board?.some((row) => row.key === key)) return key;
  return snap?.board?.[0]?.key ?? snap?.runbooks?.[0]?.projectKey ?? null;
}

export function setProject(key) {
  setShared("muster.project", key ?? null);
}

export function selectedCard(snap = snapshot()) {
  const id = shared("muster.card");
  if (id && snap?.cards?.some((card) => card.id === id)) return id;
  return null;
}

export function setCard(id) {
  setShared("muster.card", id ?? null);
}

/** The center view the person last chose. */
export function activeView() {
  return shared("muster.view") ?? "board";
}

export function setView(child) {
  setShared("muster.view", child);
}

/** Move the center stack and remember it. */
export function select(child) {
  setView(child);
  run("layout.select", { stack: "center", child });
}

/** Open a card in the cards view. */
export function openCard(card) {
  if (!card) return;
  setCard(card.id);
  if (card.project?.key) setProject(card.project.key);
  select("cards");
}

/** Open a card by id when the snapshot may not carry the whole card. */
export function openCardId(projectKey, cardId) {
  if (cardId) setCard(cardId);
  if (projectKey) setProject(projectKey);
  select("cards");
}

export function projectRow(key, snap = snapshot()) {
  return snap?.board?.find((row) => row.key === key) ?? null;
}

export function needs(snap = snapshot()) {
  return (snap?.cards ?? []).filter(
    (card) =>
      ["open", "claimed"].includes(card.state) &&
      (["question", "approval"].includes(card.kind) || ["blocked", "attention"].includes(card.severity)),
  );
}

export function liveRuns(snap = snapshot()) {
  return (snap?.runs ?? []).filter((run) => !run.endedAt);
}

/** The next thing that needs a person: a waiting card, else the first open one. */
export function nextCard(snap = snapshot()) {
  const waiting = needs(snap);
  if (waiting.length) return waiting[0];
  return (snap?.cards ?? []).find((card) => ["open", "claimed"].includes(card.state)) ?? null;
}
