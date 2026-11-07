import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { HERDR_ASSETS } from "./assets.ts";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function backup(path: string): string {
  const base = `${path}.bak-${Date.now()}`;
  let dest = base;
  let n = 1;
  while (existsSync(dest)) dest = `${base}-${n++}`;
  copyFileSync(path, dest);
  return dest;
}

/** Disable Muster's Herdr integration without deleting its data or other files. */
export function uninstallHerdr(options: { appHome?: string } = {}) {
  const appHome = resolve(options.appHome || process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"));
  const removed: string[] = [];
  const backups: string[] = [];
  const warnings: string[] = [];
  const safePath = (path: string) => {
    const parts = relative(appHome, path).split(sep);
    if (parts.some((part) => part === "..")) return false;
    let current = appHome;
    for (const part of parts) {
      current = join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) return false;
    }
    return true;
  };
  const recordPath = join(appHome, "muster.json");
  let record: Record<string, unknown> = {};
  if (existsSync(recordPath)) {
    try {
      const value: unknown = JSON.parse(readFileSync(recordPath, "utf8"));
      if (object(value)) record = value;
      else warnings.push("Install record is invalid; existing key bindings and runtime were kept.");
    } catch { warnings.push("Install record is unreadable; existing key bindings and runtime were kept."); }
  }

  // Remove the layout and mod manifest first so optional cleanup cannot leave them active.
  const assetPaths = Object.keys(HERDR_ASSETS).filter((path) => path !== "keys.json");
  assetPaths.sort((a, b) => {
    const priority = (path: string) => path === "layouts/muster.json" ? 0 : path === "mods/muster/mod.json" ? 1 : 2;
    return priority(a) - priority(b);
  });
  for (const path of assetPaths) {
    const dest = join(appHome, ...path.split("/"));
    if (!existsSync(dest)) continue;
    try {
      if (!safePath(dest)) throw new Error("Path contains a symbolic link");
      if (readFileSync(dest, "utf8") !== HERDR_ASSETS[path]) backups.push(backup(dest));
      unlinkSync(dest);
      removed.push(dest);
    } catch (error) { warnings.push(`Could not remove ${dest}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  const keysPath = join(appHome, "keys.json");
  if (object(record.addedBindings) && existsSync(keysPath)) {
    try {
      if (!safePath(keysPath)) throw new Error("Path contains a symbolic link");
      const keys: unknown = JSON.parse(readFileSync(keysPath, "utf8"));
      if (!object(keys) || !object(keys["layout:muster"])) throw new Error("Invalid layout:muster bindings");
      const section = keys["layout:muster"];
      let changed = false;
      const defaults = JSON.parse(HERDR_ASSETS["keys.json"]!)["layout:muster"] as Record<string, string>;
      for (const [key, value] of Object.entries(record.addedBindings)) {
        if (Object.hasOwn(defaults, key) && typeof value === "string" && Object.hasOwn(section, key) && section[key] === value) {
          delete section[key];
          changed = true;
        }
      }
      if (changed) {
        if (!Object.keys(section).length) delete keys["layout:muster"];
        backups.push(backup(keysPath));
        writeFileSync(keysPath, `${JSON.stringify(keys, null, 2)}\n`);
      }
    } catch (error) { warnings.push(`Could not clean up ${keysPath}: ${error instanceof Error ? error.message : String(error)}`); }
  } else if (existsSync(keysPath) && !object(record.addedBindings)) {
    warnings.push("Key ownership was not recorded; existing key bindings were kept.");
  }

  const appDir = join(appHome, "muster");
  if (object(record.runtime) && typeof record.runtime.file === "string" && typeof record.runtime.sha256 === "string"
      && basename(record.runtime.file) === record.runtime.file && ![".", ".."].includes(record.runtime.file)) {
    const runtime = join(appDir, record.runtime.file);
    if (existsSync(runtime)) {
      try {
        if (!safePath(runtime)) throw new Error("Path contains a symbolic link");
        let sameProcess = process.platform === "win32"
          ? resolve(runtime).toLowerCase() === resolve(process.execPath).toLowerCase()
          : resolve(runtime) === resolve(process.execPath);
        if (!sameProcess) {
          const targetStat = statSync(runtime);
          const processStat = statSync(process.execPath);
          sameProcess = targetStat.ino !== 0 && targetStat.ino === processStat.ino && targetStat.dev === processStat.dev;
        }
        if (sameProcess) warnings.push(`The running executable was kept: ${runtime}`);
        else if (createHash("sha256").update(readFileSync(runtime)).digest("hex") !== record.runtime.sha256) warnings.push(`Modified app file was kept: ${runtime}`);
        else { unlinkSync(runtime); removed.push(runtime); }
      } catch (error) { warnings.push(`Could not remove ${runtime}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  } else if (existsSync(appDir)) warnings.push(`App files were kept because their ownership was not recorded: ${appDir}`);

  if (existsSync(recordPath) && warnings.length === 0) {
    try { unlinkSync(recordPath); removed.push(recordPath); }
    catch (error) { warnings.push(`Could not remove ${recordPath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const dir of [join(appHome, "mods", "muster", "icons"), join(appHome, "mods", "muster"), appDir]) {
    try { rmdirSync(dir); } catch { /* Missing or contains user files/backups. */ }
  }
  const disabled = !existsSync(join(appHome, "layouts", "muster.json")) && !existsSync(join(appHome, "mods", "muster", "mod.json"));
  return { target: "herdr", appHome, disabled, removed, backups, warnings };
}
