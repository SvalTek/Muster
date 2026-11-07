// Project identity: the durable key a card belongs to, resolved from the
// folder an agent or a person is working in. A marker is an override, not a
// requirement: `.muster.json` wins, then the git remote, then a manifest,
// then the folder name plus a path hash.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, parse as parsePath, resolve } from "node:path";
import { slugify, shortHash } from "./util.ts";

export const MARKER_FILE = ".muster.json";

/** The colors Muster assigns when a marker has none. */
export const PROJECT_COLORS = [
  "#a8b79a",
  "#c9b47c",
  "#cd8f86",
  "#9fb0c4",
  "#b3a3bd",
  "#8fb3ae",
  "#c4a98f",
  "#b0b0a4",
] as const;

/** The optional file a project can carry to pin its identity and name. */
export interface Marker {
  /** Stable key, e.g. `gh:acme/api` or `team/ledger`. Defaults to what inference finds. */
  id?: string;
  /** The name Muster shows. Defaults to the repository or folder name. */
  name?: string;
  /** A hex color for the project's mark. Defaults to a hash-assigned color. */
  color?: string;
  /** A markdown runbook, relative to the project root. */
  runbook?: string;
  /** Links shown on the project card. */
  links?: Array<{ label: string; url: string }>;
}

export interface GitInfo {
  /** The checkout or worktree root. */
  top: string;
  /** The main repository's `.git` folder, shared by every worktree. */
  common: string;
  branch: string | null;
  /** True when this checkout is a linked worktree rather than the main one. */
  worktree: boolean;
}

export type ProjectSource = "marker" | "git" | "manifest" | "folder";

export interface ResolvedProject {
  key: string;
  name: string;
  color: string;
  root: string;
  source: ProjectSource;
  remote: string | null;
  markerPath: string | null;
  marker: Marker | null;
  git: GitInfo | null;
}

const HOST_ALIASES: Record<string, string> = {
  "github.com": "gh",
  "www.github.com": "gh",
  "gitlab.com": "gl",
  "www.gitlab.com": "gl",
  "bitbucket.org": "bb",
  "codeberg.org": "cb",
  "git.sr.ht": "srht",
};

function run(command: string, args: string[], cwd?: string): string | null {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return null;
  const out = (result.stdout ?? "").trim();
  return out.length > 0 ? out : null;
}

/** A git command in `cwd`, or null when git is missing or the command fails. */
export function git(cwd: string, ...args: string[]): string | null {
  return run("git", args, cwd);
}

/** The checkout, common dir, branch and worktree flag for `cwd`. */
export function gitInfo(cwd: string): GitInfo | null {
  const top = git(cwd, "rev-parse", "--show-toplevel");
  if (!top) return null;
  const absoluteCommon = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const rawCommon = absoluteCommon ?? git(cwd, "rev-parse", "--git-common-dir");
  const common = rawCommon ? resolve(cwd, rawCommon) : resolve(top, ".git");
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  return {
    top: resolve(top),
    common,
    branch: branch === "HEAD" ? null : branch,
    worktree: normalizePath(common) !== normalizePath(resolve(top, ".git")),
  };
}

function normalizePath(path: string): string {
  const cleaned = resolve(path).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

/** `git@github.com:acme/api.git`, an HTTPS URL or an SSH URL to one key. */
export function canonicalRemote(raw: string): { host: string; path: string; key: string } | null {
  let value = raw.trim().replace(/^git\+/, "");
  if (!value || value.startsWith("file://")) return null;

  let host = "";
  let repoPath = "";

  const scpLike = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(value);
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(value);
  if (!value.includes("://") && scpLike && !isWindowsPath) {
    host = scpLike[1] ?? "";
    repoPath = scpLike[2] ?? "";
  } else {
    try {
      const url = new URL(value);
      if (url.protocol === "file:") return null;
      host = url.hostname;
      repoPath = url.pathname;
      if (url.port && !["22", "80", "443"].includes(url.port)) host = `${host}:${url.port}`;
    } catch {
      return null;
    }
  }

  repoPath = repoPath.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  host = host.toLowerCase();
  if (!host || !repoPath) return null;

  const known = HOST_ALIASES[host];
  const key = `${known ?? host}:${known ? repoPath.toLowerCase() : repoPath}`;
  return { host, path: known ? repoPath.toLowerCase() : repoPath, key };
}

/** The first `.muster.json` walking up from `start`. */
export function findMarker(start: string): { dir: string; path: string; marker: Marker } | null {
  let dir = resolve(start);
  const root = parsePath(dir).root;
  for (;;) {
    const path = resolve(dir, MARKER_FILE);
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        const marker = parsed && typeof parsed === "object" ? (parsed as Marker) : {};
        return { dir, path, marker };
      } catch {
        // A broken marker should not make every command fail; inference takes over.
        return { dir, path, marker: {} };
      }
    }
    if (normalizePath(dir) === normalizePath(root)) return null;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

/** A display name from package.json, Cargo.toml, pyproject.toml or go.mod. */
export function manifestName(root: string): string | null {
  const read = (name: string): string | null => {
    try {
      return readFileSync(resolve(root, name), "utf8");
    } catch {
      return null;
    }
  };

  const pkg = read("package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // fall through to the other manifests
    }
  }

  const cargo = read("Cargo.toml");
  const cargoName = cargo ? /^\s*name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] : undefined;
  if (cargoName) return cargoName;

  const pyproject = read("pyproject.toml");
  const pyName = pyproject ? /^\s*name\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1] : undefined;
  if (pyName) return pyName;

  const gomod = read("go.mod");
  const module = gomod ? /^module\s+(\S+)/m.exec(gomod)?.[1] : undefined;
  if (module) return module.split("/").filter(Boolean).pop() ?? module;

  return null;
}

/** The deterministic mark color for a project key. */
export function colorForKey(key: string): string {
  const index = parseInt(shortHash(key), 36) % PROJECT_COLORS.length;
  return PROJECT_COLORS[index] ?? PROJECT_COLORS[0];
}

/** Resolve a folder to the project Muster files its cards under. */
export function resolveProject(cwd = process.cwd()): ResolvedProject {
  const start = resolve(cwd);
  const markerHit = findMarker(start);
  const info = gitInfo(start);
  const root = info?.top ?? markerHit?.dir ?? start;

  const remote = info ? git(start, "remote", "get-url", "origin") : null;
  const canonical = remote ? canonicalRemote(remote) : null;
  const marker = markerHit?.marker ?? null;
  const fromManifest = manifestName(root);

  // The common dir's parent is the main checkout's folder, so a worktree and
  // its checkout agree even when they have no remote.
  const repoFolder = info ? basename(resolve(info.common, "..")) : basename(root);
  const localName = fromManifest || repoFolder;
  const key =
    marker?.id?.trim() ||
    canonical?.key ||
    `local:${slugify(localName)}-${shortHash(normalizePath(info?.common ?? root))}`;

  const name =
    marker?.name?.trim() ||
    (canonical ? (canonical.path.split("/").pop() ?? basename(root)) : localName);

  const source: ProjectSource = marker?.id?.trim()
    ? "marker"
    : canonical
      ? "git"
      : fromManifest
        ? "manifest"
        : "folder";

  return {
    key,
    name,
    color: marker?.color?.trim() || colorForKey(key),
    root,
    source,
    remote,
    markerPath: markerHit?.path ?? null,
    marker,
    git: info,
  };
}

export interface InitOptions {
  name?: string;
  id?: string;
  color?: string;
  runbook?: string;
  force?: boolean;
}

/** Write `.muster.json` at the project root, keeping any keys already there. */
export function initMarker(cwd = process.cwd(), options: InitOptions = {}): {
  path: string;
  marker: Marker;
  project: ResolvedProject;
} {
  const project = resolveProject(cwd);
  const existing = findMarker(cwd);

  const dir = existing?.dir ?? project.root;
  const path = existing?.path ?? resolve(dir, MARKER_FILE);
  const before = options.force ? {} : (existing?.marker ?? {});
  const marker: Marker = {
    ...before,
    id: options.id?.trim() || before.id || project.key,
    name: options.name?.trim() || before.name || project.name,
    color: options.color?.trim() || before.color || project.color,
  };
  if (options.runbook?.trim() || before.runbook) {
    marker.runbook = options.runbook?.trim() || before.runbook;
  }

  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return { path, marker, project: resolveProject(dir) };
}
