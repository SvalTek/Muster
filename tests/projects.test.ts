import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canonicalRemote,
  colorForKey,
  initMarker,
  resolveProject,
} from "../app/projects.ts";

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `muster-${label}-`));
}

function expectSameFile(first: string, second: string): void {
  const a = statSync(first, { bigint: true });
  const b = statSync(second, { bigint: true });
  if (a.ino !== 0n && b.ino !== 0n) {
    expect([a.dev, a.ino]).toEqual([b.dev, b.ino]);
  } else {
    const normalize = (path: string) => process.platform === "win32" ? realpathSync(path).toLowerCase() : realpathSync(path);
    expect(normalize(first)).toBe(normalize(second));
  }
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function repo(label: string, remote?: string): string {
  const dir = tempDir(label);
  git(dir, "init", "-q");
  git(dir, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "--allow-empty", "-m", "init");
  if (remote) git(dir, "remote", "add", "origin", remote);
  return dir;
}

describe("canonicalRemote", () => {
  test("normalizes the same repository across transports", () => {
    const forms = [
      "git@github.com:acme/api.git",
      "https://github.com/acme/api.git",
      "https://github.com/Acme/API",
      "ssh://git@github.com/acme/api",
      "git+ssh://git@github.com/acme/api.git",
      "https://user:token@github.com/acme/api",
    ];
    for (const form of forms) {
      expect(canonicalRemote(form)?.key).toBe("gh:acme/api");
    }
  });

  test("keeps other hosts and their paths", () => {
    expect(canonicalRemote("git@gitlab.com:Acme/Api.git")?.key).toBe("gl:acme/api");
    expect(canonicalRemote("https://example.com/team/Thing.git")?.key).toBe("example.com:team/Thing");
  });

  test("rejects local paths", () => {
    expect(canonicalRemote("C:\\work\\api")).toBeNull();
    expect(canonicalRemote("file:///C:/work/api")).toBeNull();
    expect(canonicalRemote("")).toBeNull();
  });
});

describe("resolveProject", () => {
  test("uses the git remote and is stable from a nested folder", () => {
    const dir = repo("nested", "git@github.com:acme/api.git");
    try {
      expect(resolveProject(dir).key).toBe("gh:acme/api");
      expect(resolveProject(dir).name).toBe("api");
      expect(resolveProject(dir).source).toBe("git");
      const sub = resolve(dir, "src", "deep");
      mkdirSync(sub, { recursive: true });
      expect(resolveProject(sub).key).toBe("gh:acme/api");
      expectSameFile(resolveProject(sub).root, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a worktree shares the main repository's key", () => {
    const dir = repo("worktree", "git@github.com:acme/api.git");
    const tree = join(tempDir("tree"), "wt");
    try {
      git(dir, "worktree", "add", "-q", tree, "-b", "feature");
      expect(resolveProject(tree).key).toBe("gh:acme/api");
      expect(resolveProject(tree).git?.worktree).toBe(true);
      expect(resolveProject(dir).git?.worktree).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(resolve(tree, ".."), { recursive: true, force: true });
    }
  });

  test("two clones with the same remote agree", () => {
    const one = repo("clone-a", "https://github.com/acme/api.git");
    const two = repo("clone-b", "https://github.com/acme/api.git");
    try {
      expect(resolveProject(one).key).toBe(resolveProject(two).key);
    } finally {
      rmSync(one, { recursive: true, force: true });
      rmSync(two, { recursive: true, force: true });
    }
  });

  test("a marker pins the id, name and color", () => {
    const dir = repo("marker", "git@github.com:acme/api.git");
    try {
      writeFileSync(
        join(dir, ".muster.json"),
        JSON.stringify({ id: "acme/api", name: "Acme API", color: "#123456" }),
      );
      const project = resolveProject(dir);
      expect(project.key).toBe("acme/api");
      expect(project.name).toBe("Acme API");
      expect(project.color).toBe("#123456");
      expect(project.source).toBe("marker");
      expect(project.markerPath).toBe(join(dir, ".muster.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a manifest names a folder with no git and the key stays path-local", () => {
    const dir = tempDir("manifest");
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ledger-ui" }));
      const project = resolveProject(dir);
      expect(project.name).toBe("ledger-ui");
      expect(project.source).toBe("manifest");
      expect(project.key.startsWith("local:ledger-ui-")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("moving a non-git folder changes the path-local key", () => {
    const one = join(tempDir("move-a"), "notes");
    const two = join(tempDir("move-b"), "notes");
    try {
      mkdirSync(one, { recursive: true });
      mkdirSync(two, { recursive: true });
      expect(resolveProject(one).key).not.toBe(resolveProject(two).key);
    } finally {
      rmSync(one, { recursive: true, force: true });
      rmSync(two, { recursive: true, force: true });
    }
  });
});

describe("initMarker", () => {
  test("writes a usable marker and keeps existing fields", () => {
    const dir = repo("init", "git@github.com:acme/api.git");
    try {
      const first = initMarker(dir, { runbook: "docs/runbook.md" });
      expect(first.marker.id).toBe("gh:acme/api");
      expect(first.marker.name).toBe("api");
      expect(first.marker.runbook).toBe("docs/runbook.md");

      const second = initMarker(dir, { name: "Acme API" });
      expectSameFile(second.path, first.path);
      expect(second.marker.id).toBe("gh:acme/api");
      expect(second.marker.name).toBe("Acme API");
      expect(resolveProject(dir).source).toBe("marker");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("colorForKey", () => {
  test("is deterministic and always a hex color", () => {
    expect(colorForKey("gh:acme/api")).toBe(colorForKey("gh:acme/api"));
    expect(colorForKey("gh:acme/api")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
