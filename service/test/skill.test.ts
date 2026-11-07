import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { skillText } from "../src/skill.ts";
import { SKILL_SECTIONS } from "../src/skill-content.ts";

function cli(...args: string[]) {
  return spawnSync(process.execPath, [join(import.meta.dir, "../src/cli.ts"), "skill", ...args], { encoding: "utf8" });
}

describe("skill CLI", () => {
  test("prints the main guide and selected section", () => {
    const main = cli();
    expect(main.status).toBe(0);
    expect(main.stdout).toBe(skillText());
    const section = cli("cli");
    expect(section.status).toBe(0);
    expect(section.stdout).toBe(skillText("cli"));
    const json = cli("mcp", "--json");
    expect(JSON.parse(json.stdout)).toEqual({ section: "mcp", text: skillText("mcp") });
    expect(cli("all").stdout).toContain("# CARDS");
  }, 30000);

  test("searches across guides and reports missing matches", () => {
    const result = cli("pending");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(skillText("pending"));
    expect(result.stdout).toContain("## mcp.md");
    expect(result.stdout).toContain("## cli.md");
    expect(cli("constructor").stdout).toContain("No skill results");
  });

  test("embedded guides match their source files", () => {
    for (const [key, filename] of Object.entries({ skill: "SKILL.md", cli: "cli.md", mcp: "mcp.md", cards: "cards.md" })) {
      expect(SKILL_SECTIONS[key]).toBe(readFileSync(join(import.meta.dir, "../../.agents/skills/muster", filename), "utf8"));
    }
  });
});
