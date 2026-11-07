import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../app/db.ts";
import { answerCardById } from "../app/api.ts";
import { handleMessage } from "../app/mcp.ts";

let dir: string;
let project: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "muster-mcp-"));
  project = join(dir, "acme-api");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, ".muster.json"),
    `${JSON.stringify({ id: "gh:acme/api", name: "Acme API", color: "#a8b79a" }, null, 2)}\n`,
  );
  writeFileSync(
    join(project, "release.md"),
    ["# Release", "", "## Bump versions", "", "```sh", "bun run bump", "```", "", "## Publish", ""].join("\n"),
  );
  process.env.MUSTER_HOME = join(dir, "home");
  process.env.MUSTER_DB = join(dir, "home", "muster.db");
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  const response = await handleMessage({ jsonrpc: "2.0", id, method, params });
  return response as { result?: any; error?: { code: number; message: string } };
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const response = await rpc("tools/call", { name, arguments: { path: project, ...args } });
  const result = response.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return { isError: Boolean(result?.isError), value: JSON.parse(result.content[0]?.text ?? "null") };
}

describe("mcp protocol", () => {
  test("initialize names Muster and carries the agent policy", async () => {
    const response = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
    expect(response.error).toBeUndefined();
    expect(response.result.serverInfo.name).toBe("muster");
    expect(response.result.protocolVersion).toBe("2025-06-18");
    expect(response.result.capabilities.tools).toBeDefined();
    expect(response.result.instructions).toContain("Before using Muster tools, read the `muster://skill` resource");
    expect(response.result.instructions).toContain("muster://skill?section=cli");
    expect(response.result.instructions).toContain("muster_whoami");
  });

  test("an unknown protocol version falls back to the newest one", async () => {
    const response = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(response.result.protocolVersion).toBe("2025-06-18");
  });

  test("notifications get no reply and ping answers", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const pong = await rpc("ping");
    expect(pong.result).toEqual({});
  });

  test("tools/list exposes the documented tools", async () => {
    const response = await rpc("tools/list");
    const names = (response.result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual([
      "muster_whoami",
      "muster_report_status",
      "muster_post_card",
      "muster_ask_human",
      "muster_await_card",
      "muster_list_cards",
      "muster_resolve_card",
      "muster_add_artifact",
      "muster_runbook_get",
      "muster_runbook_import",
      "muster_runbook_step",
      "muster_log_event",
    ]);
    for (const entry of response.result.tools as Array<{ inputSchema: { type: string } }>) {
      expect(entry.inputSchema.type).toBe("object");
    }
  });

  test("the skill resource and its sections are discoverable and readable", async () => {
    const resources = await rpc("resources/list");
    expect(resources.result.resources.some((item: { uri: string }) => item.uri === "muster://skill")).toBe(true);
    const templates = await rpc("resources/templates/list");
    expect(templates.result.resourceTemplates.some((item: { uriTemplate: string }) => item.uriTemplate === "muster://skill{?section}")).toBe(true);

    const main = await rpc("resources/read", { uri: "muster://skill" });
    expect(main.result.contents[0].mimeType).toBe("text/markdown");
    expect(main.result.contents[0].text).toContain("# Muster");
    const cli = await rpc("resources/read", { uri: "muster://skill?section=cli" });
    expect(cli.result.contents[0].text).toContain("# Muster CLI");
    const path = await rpc("resources/read", { uri: "muster://skill/cli" });
    expect(path.result.contents[0].text).toBe(cli.result.contents[0].text);
    const search = await rpc("resources/read", { uri: "muster://skill?section=pending" });
    expect(search.result.contents[0].text).toContain("# Skill search: pending");
    expect(search.result.contents[0].text).toContain("## mcp.md");
    expect((await rpc("resources/read", { uri: "muster://skill?section=constructor" })).result.contents[0].text).toContain("No skill results");
    expect((await rpc("resources/read", { uri: "muster://skill?section=%ZZ" })).error?.code).toBe(-32002);
  });

  test("an unknown method is refused, an unknown tool is an error result", async () => {
    const missing = await rpc("nope");
    expect(missing.error?.code).toBe(-32601);
    const unknown = await tool("muster_nope");
    expect(unknown.isError).toBe(true);
    expect(unknown.value.error.code).toBe("unknown_tool");
  });
});

describe("mcp tools", () => {
  test("whoami resolves the marker and creates a run", async () => {
    const result = await tool("muster_whoami", { agent: "claude", terminal: "t1" });
    expect(result.isError).toBe(false);
    expect(result.value.project.key).toBe("gh:acme/api");
    expect(result.value.project.name).toBe("Acme API");
    expect(result.value.run.state).toBe("working");
    expect(result.value.instructions).toContain("Muster");
  });

  test("status and a report card land in the project", async () => {
    const status = await tool("muster_report_status", { state: "working", summary: "Reading the schema", terminal: "t1" });
    expect(status.value.run.summary).toBe("Reading the schema");

    const posted = await tool("muster_post_card", {
      title: "Schema read",
      body: "Found the users table",
      kind: "report",
      terminal: "t1",
      dedupe_key: "schema-read",
    });
    expect(posted.value.deduped).toBe(false);
    const again = await tool("muster_post_card", { title: "Schema read", terminal: "t1", dedupe_key: "schema-read" });
    expect(again.value.deduped).toBe(true);
    expect(again.value.card.id).toBe(posted.value.card.id);
  });

  test("ask_human returns pending, then await_card returns the answer", async () => {
    const asked = await tool("muster_ask_human", {
      question: "Postgres or SQLite?",
      choices: [
        { id: "pg", label: "Postgres", style: "primary" },
        { id: "lite", label: "SQLite" },
      ],
      timeout_s: 0,
      terminal: "t1",
    });
    expect(asked.value.state).toBe("pending");
    expect(asked.value.card.kind).toBe("question");
    expect(asked.value.card.actions).toHaveLength(2);

    answerCardById(asked.value.card.id, { actionId: "pg", by: "sam" });
    const answered = await tool("muster_await_card", { card_id: asked.value.card.id, timeout_s: 1 });
    expect(answered.value.state).toBe("answered");
    expect(answered.value.answer.actionId).toBe("pg");
  });

  test("cards can be listed and resolved", async () => {
    const listed = await tool("muster_list_cards", { states: ["open"] });
    expect(listed.value.cards.length).toBeGreaterThanOrEqual(1);
    const target = listed.value.cards[0];
    const resolved = await tool("muster_resolve_card", { card_id: target.id, resolution: "done in test" });
    expect(resolved.value.state).toBe("resolved");
  });

  test("a runbook imports and a step moves", async () => {
    const imported = await tool("muster_runbook_import", { file: "release.md" });
    expect(imported.value.slug).toBe("release");
    expect(imported.value.steps).toHaveLength(2);
    expect(imported.value.steps[0].command).toBe("bun run bump");

    const read = await tool("muster_runbook_get", { slug: "release" });
    expect(read.value.runbooks[0].steps[0].state).toBe("todo");

    const stepped = await tool("muster_runbook_step", { slug: "release", n: 1, state: "done", note: "bumped" });
    expect(stepped.value.steps[0].state).toBe("done");
    expect(stepped.value.steps[0].note).toBe("bumped");
  });

  test("an artifact needs a real file, and log_event appends", async () => {
    const missing = await tool("muster_add_artifact", { path: "nope.txt" });
    expect(missing.isError).toBe(true);
    expect(missing.value.error.code).toBe("artifact_missing");

    const file = join(project, "report.txt");
    writeFileSync(file, "log");
    const added = await tool("muster_add_artifact", { path: file, title: "Report" });
    expect(added.isError).toBe(false);
    expect(added.value.title).toBe("Report");

    const logged = await tool("muster_log_event", { kind: "tests.passed", data: { count: 21 } });
    expect(logged.value.ok).toBe(true);
  });

  test("done ends the run and the next call starts a fresh one", async () => {
    const done = await tool("muster_report_status", { state: "done", summary: "shipped", terminal: "t1" });
    expect(done.value.run.ended_at).not.toBeNull();
    const fresh = await tool("muster_whoami", { agent: "claude", terminal: "t1" });
    expect(fresh.value.run.id).not.toBe(done.value.run.id);
  });
});
