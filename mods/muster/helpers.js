// Small things every view needs: paths shown the way a person reads them,
// opening a file or link in the system's default app, and the tone and icon a
// card's kind and severity wear.

import { exec, home, window as win } from "herdr";
import { colors } from "./kit.js";

/** `C:\Users\sam\code\api` as `~/code/api`, and a plain path unchanged. */
export function shortHome(path) {
  if (!path) return "";
  const h = home();
  if (!h) return path;
  const a = path.replace(/[\\/]+$/, "");
  const b = h.replace(/[\\/]+$/, "");
  if (a.toLowerCase() === b.toLowerCase()) return "~";
  if (a.toLowerCase().startsWith(b.toLowerCase() + "\\")) return "~\\" + a.slice(b.length + 1);
  if (a.toLowerCase().startsWith(b.toLowerCase() + "/")) return "~/" + a.slice(b.length + 1);
  return path;
}

export function baseName(path) {
  if (!path) return "";
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
}

/** Opens a URL or file in the system's default app. */
export function openExternal(target) {
  if (!target) return Promise.resolve();
  const platform = win()?.platform;
  const run = platform === "macos" ? exec("open", [target]) : platform === "windows" ? exec("cmd", ["/c", "start", "", target]) : exec("xdg-open", [target]);
  return Promise.resolve(run).catch(() => {});
}

/** The color a card's severity wears, falling back to its kind. */
export function cardTone(card, k = colors()) {
  if (card.severity === "blocked") return k.blocked;
  if (card.severity === "success") return k.done;
  if (card.severity === "attention") return k.working;
  if (card.kind === "question" || card.kind === "approval") return k.working;
  if (card.kind === "result") return k.done;
  return k.muted;
}

/** The icon a card's kind wears. */
export function kindIcon(kind) {
  switch (kind) {
    case "question":
      return "inbox";
    case "approval":
      return "alert";
    case "result":
      return "check";
    case "progress":
      return "clock";
    default:
      return "cards";
  }
}

/** The icon a step or card state wears. */
export function stateIcon(state) {
  switch (state) {
    case "done":
    case "resolved":
    case "answered":
      return "check";
    case "blocked":
    case "failed":
      return "alert";
    case "doing":
    case "claimed":
      return "clock";
    case "skipped":
    case "dismissed":
      return "chevron-right";
    default:
      return null;
  }
}

/** The word a board next-kind stands for. */
export function verbFor(kind) {
  switch (kind) {
    case "answer":
      return "Answer";
    case "unblock":
      return "Unblock";
    case "review":
      return "Review";
    default:
      return "Open";
  }
}

/** One line about a run's state. */
export function runLine(run) {
  if (!run) return null;
  const summary = (run.summary ?? "").trim();
  return summary || run.state;
}
