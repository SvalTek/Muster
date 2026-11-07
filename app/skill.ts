// The generated copy travels with the package and is embedded in compiled binaries.
import { SKILL_SECTIONS } from "./skill-content.ts";

const SECTION_ALIASES: Record<string, string> = {
  main: "skill", index: "skill", readme: "skill", muster: "skill",
  command: "cli", commands: "cli", server: "mcp", card: "cards", model: "cards",
};

/** Read a named guide or search matching Markdown sections across all guides. */
export function skillText(query?: string): string {
  const input = (query ?? "").trim();
  if (!input) return SKILL_SECTIONS.skill ?? "";
  const key = input.toLowerCase().replace(/\.md$/, "");
  const section = Object.hasOwn(SECTION_ALIASES, key) ? SECTION_ALIASES[key]! : key;
  if (section === "all") {
    return Object.entries(SKILL_SECTIONS).map(([name, text]) => `# ${name.toUpperCase()}\n\n${text}`).join("\n\n---\n\n");
  }
  if (Object.hasOwn(SKILL_SECTIONS, section)) return SKILL_SECTIONS[section]!;

  const needle = input.toLowerCase();
  const matches: string[] = [];
  for (const [name, text] of Object.entries(SKILL_SECTIONS)) {
    const blocks = text.split(/(?=^#{1,6} )/m);
    const found = blocks.filter((block) => block.toLowerCase().includes(needle));
    if (found.length) matches.push(`## ${name === "skill" ? "SKILL" : name}.md\n\n${found.map((block) => block.trim()).join("\n\n")}`);
  }
  return matches.length
    ? `# Skill search: ${input}\n\n${matches.join("\n\n---\n\n")}\n`
    : `No skill results for: ${input}\n`;
}
