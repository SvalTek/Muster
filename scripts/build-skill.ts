#!/usr/bin/env bun
// Regenerate app/skill-content.ts from the skill markdown files.
// Usage: bun run scripts/build-skill.ts [--src DIR] [--out FILE]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const args = process.argv.slice(2);
let src = resolve(import.meta.dir, "../.agents/skills/muster");
let out = resolve(import.meta.dir, "../app/skill-content.ts");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--src") src = resolve(args[++i] ?? "");
  else if (args[i] === "--out") out = resolve(args[++i] ?? "");
}

const files: Record<string, string> = {
  skill: "SKILL.md",
  cli: "cli.md",
  mcp: "mcp.md",
  cards: "cards.md",
};

const sections: Record<string, string> = {};
for (const [key, name] of Object.entries(files)) {
  const path = resolve(src, name);
  if (!existsSync(path)) throw new Error(`missing skill file: ${path}`);
  sections[key] = readFileSync(path, "utf8");
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const body = `// Generated from .agents/skills/muster/*.md. Do not edit by hand.
// Regenerate with: bun run scripts/build-skill.ts [--src DIR] [--out FILE]

export const SKILL_SECTIONS: Record<string, string> = {
${Object.entries(sections)
  .map(([key, value]) => `  ${JSON.stringify(key)}: \`${escape(value)}\`,`)
  .join("\n")}
};

export const SKILL_SECTION_NAMES = ${JSON.stringify(Object.keys(sections))} as const;
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body);
console.log(`wrote ${out} (${Object.keys(sections).length} sections, ${body.length} bytes)`);
