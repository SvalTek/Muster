import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../app/db.ts";
import type { ResolvedProject } from "../app/projects.ts";
import {
  answerCard,
  board,
  dismissCard,
  ensureProject,
  ensureRun,
  getCard,
  importRunbook,
  listCards,
  postCard,
  resolveCard,
  setRunbookStep,
  setRunState,
  snapshot,
  stats,
} from "../app/store.ts";

const ref: ResolvedProject = {
  key: "gh:acme/api",
  name: "api",
  color: "#a8b79a",
  root: process.cwd(),
  source: "git",
  remote: "git@github.com:acme/api.git",
  markerPath: null,
  marker: null,
  git: null,
};

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("projects and runs", () => {
  test("one live run per terminal, refreshed on every report", () => {
    const project = ensureProject(db, ref);
    const first = ensureRun(db, project.id, { terminal: "t1", cwd: "C:/work/api", agent: "claude" });
    const again = ensureRun(db, project.id, { terminal: "t1", cwd: "C:/work/api", agent: "claude" });
    expect(again.id).toBe(first.id);

    const other = ensureRun(db, project.id, { terminal: "t2", cwd: "C:/work/api", agent: "codex" });
    expect(other.id).not.toBe(first.id);
  });

  test("done ends the run so the next session starts fresh", () => {
    const project = ensureProject(db, ref);
    const run = ensureRun(db, project.id, { terminal: "t1", cwd: "C:/work/api" });
    const ended = setRunState(db, run.id, "done", "shipped");
    expect(ended.endedAt).not.toBeNull();
    const next = ensureRun(db, project.id, { terminal: "t1", cwd: "C:/work/api" });
    expect(next.id).not.toBe(run.id);
  });
});

describe("cards", () => {
  test("dedupe returns the live card instead of a second one", () => {
    const project = ensureProject(db, ref);
    const one = postCard(db, { projectId: project.id, title: "Pick a database", dedupeKey: "db-choice" });
    const two = postCard(db, { projectId: project.id, title: "Pick a database", dedupeKey: "db-choice" });
    expect(one.deduped).toBe(false);
    expect(two.deduped).toBe(true);
    expect(two.card.id).toBe(one.card.id);
  });

  test("answer records the choice and resolve closes it", () => {
    const project = ensureProject(db, ref);
    const { card } = postCard(db, {
      projectId: project.id,
      title: "Ship the migration?",
      kind: "approval",
      severity: "attention",
      actions: [
        { id: "allow", label: "Allow", style: "primary" },
        { id: "deny", label: "Deny", style: "danger", confirm: true },
      ],
    });
    const answered = answerCard(db, card.id, { actionId: "allow", by: "sam" });
    expect(answered.state).toBe("answered");
    expect(answered.answer?.actionId).toBe("allow");
    expect(answered.version).toBe(2);

    const resolved = resolveCard(db, card.id, "merged");
    expect(resolved.state).toBe("resolved");
  });

  test("a stale version is refused", () => {
    const project = ensureProject(db, ref);
    const { card } = postCard(db, { projectId: project.id, title: "Question" });
    answerCard(db, card.id, { text: "first" });
    expect(() => answerCard(db, card.id, { text: "second" }, { expectedVersion: 1 })).toThrow(/changed/);
  });

  test("dismiss removes a card from the attention list", () => {
    const project = ensureProject(db, ref);
    const { card } = postCard(db, { projectId: project.id, title: "Noise" });
    dismissCard(db, card.id);
    expect(listCards(db, { projectId: project.id })).toHaveLength(0);
    expect(getCard(db, card.id)?.state).toBe("dismissed");
  });
});

describe("rollup and stats", () => {
  test("board puts the waiting question first", () => {
    const project = ensureProject(db, ref);
    ensureRun(db, project.id, { terminal: "t1", cwd: "C:/work/api" });
    postCard(db, { projectId: project.id, title: "A report" });
    postCard(db, { projectId: project.id, title: "Use Postgres or SQLite?", kind: "question", severity: "attention" });

    const rows = board(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.needs).toBe(1);
    expect(rows[0]?.liveRuns).toBe(1);
    expect(rows[0]?.next.kind).toBe("answer");
    expect(rows[0]?.next.label).toBe("Use Postgres or SQLite?");
  });

  test("stats count answers and produce a full activity series", () => {
    const project = ensureProject(db, ref);
    const { card } = postCard(db, { projectId: project.id, title: "Answered" });
    answerCard(db, card.id, { text: "yes" });
    const value = stats(db, { days: 7 });
    expect(value.totals.projects).toBe(1);
    expect(value.totals.cardsAnswered).toBe(1);
    expect(value.response.answered).toBe(1);
    expect(value.activity).toHaveLength(7);
    expect(value.projects[0]?.answered).toBe(1);
  });

  test("snapshot carries board, cards, events, stats and runbooks", () => {
    ensureProject(db, ref);
    const value = snapshot(db);
    expect(value.version).toBe(1);
    expect(value.board).toHaveLength(1);
    expect(value.stats.windowDays).toBe(14);
    expect(Array.isArray(value.cards)).toBe(true);
    expect(Array.isArray(value.events)).toBe(true);
  });
});

describe("runbooks", () => {
  test("import parses headings and keeps state across re-imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "muster-book-"));
    const file = join(dir, "release.md");
    writeFileSync(file, ["# Release", "", "## 1. Bump versions", "", "```sh", "bun run bump", "```", "", "## 2. Publish", ""].join("\n"));
    try {
      const project = ensureProject(db, { ...ref, root: dir });
      const imported = importRunbook(db, project, file);
      expect(imported.title).toBe("Release");
      expect(imported.steps).toHaveLength(2);
      expect(imported.steps[0]?.title).toBe("Bump versions");
      expect(imported.steps[0]?.command).toBe("bun run bump");

      const stepped = setRunbookStep(db, { projectKey: project.key, slug: "release", n: 1, state: "done" });
      expect(stepped.steps[0]?.state).toBe("done");

      const again = importRunbook(db, project, file);
      expect(again.steps[0]?.state).toBe("done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
