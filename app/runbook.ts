// The markdown runbook: `##` headings are steps, a fenced block under a step
// is its command, and a `<!-- muster: command=... -->` comment works too.
// State lives in the database, so editing the file never loses progress.

import { basename } from "node:path";

export interface ParsedStep {
  n: number;
  title: string;
  command: string | null;
}

export interface ParsedRunbook {
  title: string;
  steps: ParsedStep[];
}

const NUMBERING = /^(?:step\s+)?\d+\s*[.):-]\s*/i;

/** Parse a runbook into ordered steps. */
export function parseRunbook(markdown: string, fallbackTitle = "Runbook"): ParsedRunbook {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = fallbackTitle;
  const steps: ParsedStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1 && title === fallbackTitle) {
      title = h1[1]?.trim() || fallbackTitle;
      continue;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (!h2) continue;

    let heading = (h2[1] ?? "").trim();
    const commandHint = /<!--\s*muster:\s*command\s*=\s*["']?([^"'>]+)["']?\s*-->/i.exec(heading);
    heading = heading
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\[[ xX]\]\s*/, "")
      .replace(NUMBERING, "")
      .trim();

    let command: string | null = commandHint?.[1]?.trim() ?? null;
    if (!command) {
      // The first fenced block before the next heading is the step's command.
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (/^##\s+/.test(next)) break;
        const fence = /^\s*```\w*\s*$/.exec(next);
        if (!fence) continue;
        const body: string[] = [];
        for (let k = j + 1; k < lines.length; k++) {
          const row = lines[k] ?? "";
          if (/^\s*```\s*$/.test(row)) break;
          body.push(row);
        }
        command = body.join("\n").trim() || null;
        break;
      }
    }

    steps.push({ n: steps.length + 1, title: heading || `Step ${steps.length + 1}`, command });
  }

  return { title, steps };
}

/** The slug a runbook file gets when none is given. */
export function runbookSlug(path: string): string {
  return basename(path).replace(/\.md$/i, "").replace(/[^\w.-]+/g, "-").toLowerCase() || "runbook";
}
