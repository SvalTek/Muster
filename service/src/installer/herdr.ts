import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { musterHome } from "../paths.ts";
import { MusterError } from "../store.ts";
import { MUSTER_VERSION } from "../version.ts";
import { HERDR_ASSETS } from "./assets.ts";

export interface HerdrInstallOptions {
  appHome?: string;
  dataHome?: string;
  db?: string;
  noKeys?: boolean;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonFile(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (object(value)) return value;
  } catch (error) {
    throw new MusterError("install_config", `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new MusterError("install_config", `Expected a JSON object in ${path}.`);
}

function backup(path: string): string {
  const base = `${path}.bak-${Date.now()}`;
  let candidate = base;
  let n = 1;
  while (existsSync(candidate)) candidate = `${base}-${n++}`;
  copyFileSync(path, candidate);
  return candidate;
}

/** Install the embedded Herdr assets, preserving unrelated files and existing keys. */
export async function installHerdr(options: HerdrInstallOptions = {}) {
  const appHome = resolve(options.appHome || process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"));
  if (!existsSync(appHome) || !statSync(appHome).isDirectory()) {
    throw new MusterError("install_app_home", `Herdr app home not found: ${appHome}. Install Herdr or pass --app-home DIR.`);
  }
  const dataHome = resolve(options.dataHome || musterHome());
  const db = resolve(options.db || (!options.dataHome && process.env.MUSTER_DB) || join(dataHome, "muster.db"));
  const keysPath = join(appHome, "keys.json");
  const keysExist = existsSync(keysPath);
  const keys = !options.noKeys && keysExist ? jsonFile(keysPath) : {};
  const existing = keys["layout:muster"];
  if (!options.noKeys && existing !== undefined && !object(existing)) {
    throw new MusterError("install_config", `The layout:muster section in ${keysPath} must be an object.`);
  }
  const defaults = JSON.parse(HERDR_ASSETS["keys.json"]!)["layout:muster"] as Record<string, string>;
  const bindings = { ...defaults, ...(object(existing) ? existing : {}) };
  const keysChanged = !options.noKeys && (existing === undefined || Object.keys(defaults).some((key) => !Object.hasOwn(existing as object, key)));
  if (keysChanged) keys["layout:muster"] = bindings;

  const serviceDir = join(appHome, "service", "muster");
  const compiled = /(?:^|[\\/])(?:~BUN|\$bunfs)(?:[\\/]|$)/i.test(Bun.main);
  let command: string;
  let prefix: string[];
  let bundle: Uint8Array | undefined;
  let binaryPath: string | undefined;
  if (compiled) {
    binaryPath = join(serviceDir, basename(process.execPath));
    command = binaryPath;
    prefix = [];
  } else {
    const result = await Bun.build({ entrypoints: [Bun.main], target: "bun", minify: false });
    if (!result.success || !result.outputs[0]) throw new MusterError("install_build", `Could not bundle Muster: ${result.logs.join("; ")}`);
    bundle = new Uint8Array(await result.outputs[0].arrayBuffer());
    command = process.execPath;
    prefix = [join(serviceDir, "cli.js")];
  }

  const backups: string[] = [];
  const layoutPath = join(appHome, "layouts", "muster.json");
  if (existsSync(layoutPath) && readFileSync(layoutPath, "utf8") !== HERDR_ASSETS["layouts/muster.json"]) backups.push(backup(layoutPath));
  if (keysChanged && keysExist) backups.push(backup(keysPath));
  for (const [path, content] of Object.entries(HERDR_ASSETS)) {
    if (path === "keys.json") continue;
    const dest = join(appHome, ...path.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  mkdirSync(serviceDir, { recursive: true });
  if (bundle) writeFileSync(prefix[0]!, bundle);
  if (binaryPath && resolve(process.execPath).toLowerCase() !== resolve(binaryPath).toLowerCase()) copyFileSync(process.execPath, binaryPath);
  mkdirSync(dataHome, { recursive: true });
  mkdirSync(dirname(db), { recursive: true });
  const record = { command, prefix, db, version: MUSTER_VERSION, installedAt: new Date().toISOString() };
  writeFileSync(join(appHome, "muster.json"), `${JSON.stringify(record, null, 2)}\n`);
  if (keysChanged) writeFileSync(keysPath, `${JSON.stringify(keys, null, 2)}\n`);
  return { target: "herdr", appHome, dataHome, db, command, prefix, keysUpdated: keysChanged, backups };
}
