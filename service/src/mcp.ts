// Muster's MCP server: newline-delimited JSON-RPC 2.0 over stdio. The tools
// are thin wrappers over api.ts, so an agent gets the same answers as the CLI.
// Nothing is ever written to stdout except protocol messages; logs go to
// stderr.

import { createInterface } from "node:readline";
import {
  addArtifactFor,
  askHuman,
  awaitCard,
  importRunbookFor,
  listCardsFor,
  logEventFor,
  MusterError,
  postCardFor,
  reportStatus,
  resolveCardById,
  runbookGet,
  runbookStep,
  whoami,
  type AgentContext,
} from "./api.ts";
import { MUSTER_INSTRUCTIONS } from "./instructions.ts";
import { skillText } from "./skill.ts";
import type { CardKind, CardState, RunState, StepState } from "./store.ts";
import { MUSTER_VERSION } from "./version.ts";

export const SERVER_NAME = "muster";
export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function rpcError(code: number, message: string, data?: unknown): RpcError {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

/** The agent context the server records on every run and card. */
function agentContext(params: Record<string, unknown> = {}): AgentContext {
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  return {
    path: str(params.path) ?? str(process.env.MUSTER_PATH) ?? process.cwd(),
    agent: str(params.agent) ?? str(process.env.MUSTER_AGENT) ?? str(process.env.MUSTER_CLIENT),
    terminal: str(params.terminal) ?? str(process.env.MUSTER_TERMINAL) ?? str(process.env.HERDR_TERMINAL_ID),
  };
}

function str(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(params: Record<string, unknown>, name: string): string[] {
  const value = params[name];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") return [value];
  return [];
}

function num(params: Record<string, unknown>, name: string, fallback?: number): number | undefined {
  const value = params[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function bool(params: Record<string, unknown>, name: string, fallback = false): boolean {
  const value = params[name];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function object(params: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const value = params[name];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function required(params: Record<string, unknown>, name: string): string {
  const value = str(params, name);
  if (!value) throw new MusterError("invalid_params", `Missing required parameter: ${name}`);
  return value;
}

function cardActions(params: Record<string, unknown>): Array<{
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  confirm?: boolean | string;
}> | undefined {
  const value = params.actions;
  if (!Array.isArray(value)) return undefined;
  const actions = value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry, index): { id: string; label: string; style?: "primary" | "secondary" | "danger"; confirm?: string | boolean } => ({
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `action-${index + 1}`,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : `Action ${index + 1}`,
      ...(entry.style === "primary" || entry.style === "secondary" || entry.style === "danger"
        ? { style: entry.style as "primary" | "secondary" | "danger" }
        : {}),
      ...(typeof entry.confirm === "boolean" || typeof entry.confirm === "string" ? { confirm: entry.confirm } : {}),
    }));
  return actions.length ? actions : undefined;
}

function choices(params: Record<string, unknown>): Array<{
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
}> | undefined {
  const value = params.choices;
  if (!Array.isArray(value)) return undefined;
  const list = value
    .map((entry, index) => {
      if (typeof entry === "string") {
        return { id: `choice-${index + 1}`, label: entry.trim(), style: "secondary" as const };
      }
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label.trim() : typeof row.id === "string" ? row.id.trim() : "";
      if (!label) return null;
      return {
        id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `choice-${index + 1}`,
        label,
        ...(row.style === "primary" || row.style === "secondary" || row.style === "danger"
          ? { style: row.style }
          : {}),
      };
    })
    .filter((entry): entry is { id: string; label: string; style?: "primary" | "secondary" | "danger" } => entry !== null);
  return list.length ? list : undefined;
}

function cardStates(params: Record<string, unknown>): CardState[] | undefined {
  const states = strings(params, "states");
  const valid = ["open", "claimed", "answered", "resolved", "dismissed", "expired"];
  const filtered = states.filter((state): state is CardState => valid.includes(state));
  return filtered.length ? filtered : undefined;
}

const TOOLS = [
  {
    name: "muster_whoami",
    title: "Who am I",
    description:
      "Resolve this project, start or refresh your run, and list the cards already waiting for you. Call this first, before any other Muster tool.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project folder. Defaults to the server's folder." },
        agent: { type: "string", description: "Agent name recorded on the run, e.g. claude or codex." },
        terminal: { type: "string", description: "Terminal handle recorded on the run." },
      },
    },
  },
  {
    name: "muster_report_status",
    title: "Report status",
    description:
      "Set your run's state with a concrete one-line summary. Use working when you begin, blocked the moment you cannot continue, and done or failed before you finish.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["working", "blocked", "waiting", "done", "failed", "idle"],
          description: "The run state. done and failed end the run.",
        },
        summary: { type: "string", description: "One concrete line about what is happening." },
        path: { type: "string", description: "Project folder. Defaults to the server's folder." },
        agent: { type: "string" },
        terminal: { type: "string" },
      },
      required: ["state", "summary"],
    },
  },
  {
    name: "muster_post_card",
    title: "Post a card",
    description:
      "Put something in front of the person: a result, a risk, a failing check or a decision record. Cards are durable; runs are not. Pass dedupe_key when retrying so one report does not become five.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, concrete title." },
        body: { type: "string", description: "Markdown detail." },
        kind: { type: "string", enum: ["question", "approval", "report", "result", "progress"] },
        severity: { type: "string", enum: ["info", "attention", "blocked", "success"] },
        actions: {
          type: "array",
          description: "Optional buttons the person can press.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              style: { type: "string", enum: ["primary", "secondary", "danger"] },
              confirm: { type: ["boolean", "string"], description: "Ask for a second press; a string is the prompt." },
            },
            required: ["id", "label"],
          },
        },
        refs: { type: "object", description: "Free-form references such as a file, branch or ticket." },
        dedupe_key: { type: "string", description: "Collapse retries of the same report into one live card." },
        path: { type: "string" },
        agent: { type: "string" },
        terminal: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "muster_ask_human",
    title: "Ask a person",
    description:
      "Ask for a decision, approval or missing context instead of guessing. Give 2-5 concrete choices. If the result state is pending, the person has not answered: do not invent an answer. Continue other work and call muster_await_card later.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question. Markdown is allowed." },
        title: { type: "string", description: "Short card title. Defaults to the first line of the question." },
        choices: {
          type: "array",
          description: "Concrete answers. A string becomes a choice with a generated id.",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  style: { type: "string", enum: ["primary", "secondary", "danger"] },
                },
                required: ["label"],
              },
            ],
          },
        },
        timeout_s: { type: "number", description: "How long to wait for an answer, 0-120. Default 25; 0 returns immediately." },
        dedupe_key: { type: "string" },
        refs: { type: "object" },
        path: { type: "string" },
        agent: { type: "string" },
        terminal: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "muster_await_card",
    title: "Await a card",
    description:
      "Wait for a card you already posted to be answered, without creating another. Returns state pending when the wait expires.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card id returned by muster_ask_human or muster_post_card." },
        timeout_s: { type: "number", description: "How long to wait, 0-120. Default 25." },
      },
      required: ["card_id"],
    },
  },
  {
    name: "muster_list_cards",
    title: "List cards",
    description: "List cards for this project (or another project key), newest attention first.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "A project key, e.g. gh:acme/api. Defaults to this project." },
        path: { type: "string" },
        states: {
          type: "array",
          items: { type: "string", enum: ["open", "claimed", "answered", "resolved", "dismissed", "expired"] },
        },
        kind: { type: "string", enum: ["question", "approval", "report", "result", "progress"] },
        limit: { type: "number", description: "Maximum rows, 1-500. Default 100." },
      },
    },
  },
  {
    name: "muster_resolve_card",
    title: "Resolve a card",
    description: "Close a card you opened once the work behind it is finished. Do not leave completed work in the attention list.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        resolution: { type: "string", description: "One line about how it ended." },
        actor: { type: "string" },
      },
      required: ["card_id"],
    },
  },
  {
    name: "muster_add_artifact",
    title: "Add an artifact",
    description: "Attach a file on this machine or an http(s) link to a card, or to your current run.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "Attach to this card. Omit to attach to the run." },
        path: { type: "string", description: "A file path, absolute or relative to the working folder." },
        url: { type: "string", description: "An http or https URL." },
        title: { type: "string" },
        mime: { type: "string" },
        agent: { type: "string" },
        terminal: { type: "string" },
      },
    },
  },
  {
    name: "muster_runbook_get",
    title: "Read the runbook",
    description: "Get this project's runbook steps and their state. Import one from the marker or call muster_runbook_import first if empty.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        path: { type: "string" },
        slug: { type: "string", description: "Only this runbook." },
      },
    },
  },
  {
    name: "muster_runbook_import",
    title: "Import a runbook",
    description: "Import a markdown runbook. `##` headings become steps; a fenced block under a step is its command. Re-importing keeps step state.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Markdown file, absolute or relative to the project root." },
        project_key: { type: "string" },
        path: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
      },
      required: ["file"],
    },
  },
  {
    name: "muster_runbook_step",
    title: "Move a runbook step",
    description:
      "Mark a runbook step doing, done, blocked or skipped. Never mark a step done unless its command really succeeded.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The runbook slug from muster_runbook_get." },
        n: { type: "number", description: "The step number, starting at 1." },
        state: { type: "string", enum: ["todo", "doing", "done", "blocked", "skipped"] },
        note: { type: "string", description: "Why, especially for blocked or skipped." },
        project_key: { type: "string" },
        path: { type: "string" },
      },
      required: ["slug", "n", "state"],
    },
  },
  {
    name: "muster_log_event",
    title: "Log an event",
    description: "Append a progress event to the activity feed. Use for milestones worth seeing, not for every file read.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "A short event name, e.g. tests.passed, migration.applied." },
        data: { type: "object", description: "Small JSON detail. Never secrets or tokens." },
        path: { type: "string" },
        agent: { type: "string" },
        terminal: { type: "string" },
      },
      required: ["kind"],
    },
  },
] as const;

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof MusterError ? error.code : "error";
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) }],
    isError: true,
  };
}

async function callTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
  const ctx = agentContext(params);
  switch (name) {
    case "muster_whoami":
      return textResult(whoami(ctx));
    case "muster_report_status": {
      const state = required(params, "state") as RunState;
      const summary = str(params, "summary");
      return textResult(reportStatus(ctx, state, summary));
    }
    case "muster_post_card": {
      const result = postCardFor(ctx, {
        title: required(params, "title"),
        body: str(params, "body"),
        kind: str(params, "kind") as CardKind | undefined,
        severity: str(params, "severity") as "info" | "attention" | "blocked" | "success" | undefined,
        actions: cardActions(params),
        refs: object(params, "refs"),
        dedupeKey: str(params, "dedupe_key"),
      });
      return textResult(result);
    }
    case "muster_ask_human": {
      const result = await askHuman(ctx, {
        question: required(params, "question"),
        title: str(params, "title"),
        choices: choices(params),
        timeoutS: num(params, "timeout_s", 25),
        dedupeKey: str(params, "dedupe_key"),
        refs: object(params, "refs"),
      });
      return textResult(result);
    }
    case "muster_await_card": {
      const result = await awaitCard(required(params, "card_id"), num(params, "timeout_s", 25) ?? 25);
      return textResult(result);
    }
    case "muster_list_cards": {
      const result = listCardsFor({
        projectKey: str(params, "project_key"),
        path: str(params, "path"),
        states: cardStates(params),
        kind: str(params, "kind") as CardKind | undefined,
        limit: num(params, "limit", 100),
        all: bool(params, "all", false),
      });
      return textResult({ cards: result });
    }
    case "muster_resolve_card": {
      const result = resolveCardById(
        required(params, "card_id"),
        str(params, "resolution"),
        str(params, "actor") ?? ctx.agent,
      );
      return textResult(result);
    }
    case "muster_add_artifact": {
      const result = addArtifactFor(ctx, {
        cardId: str(params, "card_id") ?? null,
        path: str(params, "path"),
        url: str(params, "url"),
        title: str(params, "title"),
        mime: str(params, "mime"),
      });
      return textResult(result);
    }
    case "muster_runbook_get":
      return textResult(
        runbookGet({
          projectKey: str(params, "project_key"),
          path: str(params, "path") ?? ctx.path,
          slug: str(params, "slug"),
        }),
      );
    case "muster_runbook_import": {
      const result = importRunbookFor({
        projectKey: str(params, "project_key"),
        path: str(params, "path") ?? ctx.path,
        file: required(params, "file"),
        slug: str(params, "slug"),
        title: str(params, "title"),
      });
      return textResult(result);
    }
    case "muster_runbook_step": {
      const n = num(params, "n");
      if (n === undefined || n < 1) throw new MusterError("invalid_params", "n must be a step number starting at 1.");
      const result = runbookStep({
        projectKey: str(params, "project_key"),
        path: str(params, "path") ?? ctx.path,
        slug: required(params, "slug"),
        n: Math.floor(n),
        state: required(params, "state") as StepState,
        note: str(params, "note"),
      });
      return textResult(result);
    }
    case "muster_log_event":
      return textResult(logEventFor(ctx, required(params, "kind"), object(params, "data") ?? {}));
    default:
      throw new MusterError("unknown_tool", `Unknown tool: ${name}`);
  }
}

/** Handle one JSON-RPC message. Returns null for notifications. */
export async function handleMessage(message: unknown): Promise<Record<string, unknown> | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { jsonrpc: "2.0", id: null, error: rpcError(INVALID_REQUEST, "Invalid request.") };
  }
  const request = message as RpcRequest;
  const isNotification = request.id === undefined || request.id === null;
  const reply = (result: unknown): Record<string, unknown> => ({
    jsonrpc: "2.0",
    id: request.id ?? null,
    result,
  });
  const fail = (error: RpcError): Record<string, unknown> | null =>
    isNotification ? null : { jsonrpc: "2.0", id: request.id ?? null, error };

  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return fail(rpcError(INVALID_REQUEST, "Expected a JSON-RPC 2.0 request."));
  }

  try {
    switch (request.method) {
      case "initialize": {
        const params = request.params ?? {};
        const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested)
          ? requested
          : SUPPORTED_PROTOCOLS[0];
        return reply({
          protocolVersion,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: {} },
          serverInfo: { name: SERVER_NAME, title: "Muster", version: MUSTER_VERSION },
          instructions: MUSTER_INSTRUCTIONS,
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
      case "initialized":
        return null;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        const params = request.params ?? {};
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) return fail(rpcError(INVALID_PARAMS, "tools/call needs a tool name."));
        const args =
          params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        try {
          return reply(await callTool(name, args));
        } catch (error) {
          return reply(errorResult(error));
        }
      }
      case "resources/list":
        return reply({
          resources: [
            {
              uri: "muster://skill",
              name: "Muster skill",
              description: "The Muster workflow guide: when to use it, the CLI/MCP surfaces, and card/runbook rules. Read before using the tools.",
              mimeType: "text/markdown",
            },
          ],
        });
      case "resources/templates/list":
        return reply({
          resourceTemplates: [
            {
              uriTemplate: "muster://skill{?section}",
              name: "Muster skill section",
              description: "Read skill, cli, mcp, cards, or all; other values search all skill files.",
              mimeType: "text/markdown",
            },
          ],
        });
      case "resources/read": {
        const params = request.params ?? {};
        const uri = typeof params.uri === "string" ? params.uri : "";
        const match = /^muster:\/\/skill(?:\/([^/?#]+))?(?:\?section=([^&#]*))?$/.exec(uri);
        if (!match) return fail(rpcError(-32002, `Resource not found: ${uri}`));
        let text: string;
        try {
          if (match[1] && match[2] !== undefined) return fail(rpcError(INVALID_PARAMS, "Specify the skill section only once."));
          const section = match[1] ?? match[2];
          const decoded = section === undefined ? undefined : decodeURIComponent(section.replace(/\+/g, " "));
          text = skillText(decoded);
        } catch (error) {
          return fail(rpcError(-32002, error instanceof Error ? error.message : String(error)));
        }
        return reply({ contents: [{ uri, mimeType: "text/markdown", text }] });
      }
      case "prompts/list":
        return reply({ prompts: [] });
      case "logging/setLevel":
        return reply({});
      default:
        return fail(rpcError(METHOD_NOT_FOUND, `Method not found: ${request.method}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(rpcError(INTERNAL_ERROR, message));
  }
}

function writeLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function log(line: string): void {
  process.stderr.write(`muster: ${line}\n`);
}

/** Serve MCP over stdin/stdout until the client closes the pipe. */
export async function startMcp(): Promise<void> {
  process.env.MUSTER_MCP = "1";
  log(`serving ${TOOLS.length} tools (MCP ${SUPPORTED_PROTOCOLS[0]})`);

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain: Promise<void> = Promise.resolve();

  const stop = (): void => {
    lines.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      writeLine({ jsonrpc: "2.0", id: null, error: rpcError(PARSE_ERROR, "Invalid JSON.") });
      continue;
    }
    // Requests run in order; ask_human and await_card legitimately block.
    chain = chain
      .then(async () => {
        const responses = Array.isArray(parsed)
          ? await Promise.all(parsed.map((entry) => handleMessage(entry)))
          : [await handleMessage(parsed)];
        for (const response of responses) if (response) writeLine(response);
      })
      .catch((error: unknown) => {
        log(error instanceof Error ? error.message : String(error));
      });
    await chain;
  }

  await chain;
  await Bun.sleep(10);
  process.exit(0);
}
