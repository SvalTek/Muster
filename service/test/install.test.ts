import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HERDR_ASSETS } from "../src/installer/assets.ts";

const root = mkdtempSync(join(tmpdir(), "muster-install-"));
const entry = join(import.meta.dir, "../src/cli.ts");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", cwd: root });
}

describe("Herdr installation", () => {
  test("installs a runnable service, merges keys, and preserves unrelated files on update", () => {
    const app = join(root, "app");
    const data = join(root, "data");
    mkdirSync(join(app, "service", "src"), { recursive: true });
    writeFileSync(join(app, "service", "src", "other.txt"), "keep");
    writeFileSync(join(app, "keys.json"), JSON.stringify({ global: { "alt-m": "other" }, "layout:muster": { "ctrl-shift-1": "custom" } }));
    const result = run("install", "herdr", "--app-home", app, "--muster-home", data, "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.target).toBe("herdr");
    expect(output.keysUpdated).toBe(true);
    expect(output.backups).toHaveLength(1);
    const keys = JSON.parse(readFileSync(join(app, "keys.json"), "utf8"));
    expect(keys.global["alt-m"]).toBe("other");
    expect(keys["layout:muster"]["ctrl-shift-1"]).toBe("custom");
    expect(keys["layout:muster"]["ctrl-shift-2"]).toBe("muster.go:cards");
    expect(readFileSync(join(app, "service", "src", "other.txt"), "utf8")).toBe("keep");
    expect(readFileSync(join(app, "mods", "muster", "main.js"), "utf8")).toBe(HERDR_ASSETS["mods/muster/main.js"]!);
    const record = JSON.parse(readFileSync(join(app, "muster.json"), "utf8"));
    const service = spawnSync(record.command, [...record.prefix, "snapshot", "--db", record.db, "--json"], { encoding: "utf8", cwd: root });
    expect(service.status).toBe(0);
    expect(JSON.parse(service.stdout).board).toBeArray();
    const again = run("install", "--app-home", app, "--muster-home", data, "--json");
    expect(again.status).toBe(0);
    expect(JSON.parse(again.stdout).keysUpdated).toBe(false);
    expect(JSON.parse(again.stdout).backups).toHaveLength(0);
    const layout = join(app, "layouts", "muster.json");
    writeFileSync(layout, "custom layout");
    const update = run("install", "--app-home", app, "--muster-home", data, "--json");
    expect(update.status).toBe(0);
    const layoutBackups = JSON.parse(update.stdout).backups as string[];
    expect(layoutBackups).toHaveLength(1);
    expect(readFileSync(layoutBackups[0]!, "utf8")).toBe("custom layout");
  }, 30000);

  test("validates keys before changing the app and supports skipping them", () => {
    const app = join(root, "bad-keys");
    mkdirSync(app);
    writeFileSync(join(app, "keys.json"), "invalid json");
    const bad = run("install", "--app-home", app, "--muster-home", join(root, "bad-data"));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("Cannot read");
    expect(existsSync(join(app, "themes"))).toBe(false);
    const skipped = run("install", "--app-home", app, "--muster-home", join(root, "bad-data"), "--no-keys");
    expect(skipped.status).toBe(0);
    expect(readFileSync(join(app, "keys.json"), "utf8")).toBe("invalid json");
    expect(run("install", "missing-target").status).toBe(1);
  }, 30000);

  test("embedded assets match their repository sources", () => {
    for (const [path, content] of Object.entries(HERDR_ASSETS)) {
      expect(content).toBe(readFileSync(join(import.meta.dir, "../..", path), "utf8"));
    }
  });
});
