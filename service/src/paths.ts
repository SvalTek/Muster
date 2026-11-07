// Where Muster keeps its data. One user-scoped folder, overridable with
// MUSTER_HOME so tests and sandboxes never touch the real store.

import { mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

/** The data folder: LOCALAPPDATA\Muster on Windows, XDG data elsewhere. */
export function musterHome(): string {
  const override = process.env.MUSTER_HOME?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
    return join(base, "Muster");
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return join(xdg || join(homedir(), ".local", "share"), "muster");
}

/** The SQLite database. */
export function databasePath(): string {
  return process.env.MUSTER_DB?.trim() || join(musterHome(), "muster.db");
}

/** Create the data folder when it is missing. */
export function ensureHome(): string {
  const home = musterHome();
  mkdirSync(home, { recursive: true });
  return home;
}

/** The machine a run belongs to, for shared stores and remote worktrees. */
export function machineName(): string {
  return process.env.MUSTER_MACHINE?.trim() || hostname();
}
