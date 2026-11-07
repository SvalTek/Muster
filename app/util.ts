// Small shared helpers: ids, time, text and the deterministic bits Muster
// derives instead of storing.

import { randomBytes } from "node:crypto";

/** An ISO timestamp for now. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A prefixed, collision-resistant id such as `card_9f2c1a...`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

/** FNV-1a, base 36: short keys for path-derived project ids and colors. */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(0, 7);
}

/** Lowercase, dash-separated text for ids and slugs. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "project";
}

/** Trim text and cap it so a runaway agent cannot bloat a row. */
export function text(value: unknown, max = 20_000): string {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  const trimmed = raw.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Parse JSON without throwing; `fallback` for empty or broken input. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** `1 item`, `3 items`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A compact age: now, 4m, 3h, 2d. */
export function ageText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

/** Whole seconds between two ISO timestamps, or null when either is missing. */
export function secondsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/** The day key (`2026-11-07`) for an ISO timestamp. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Median of a numeric list; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2) : (sorted[mid] ?? null);
}

/** The nearest rank at `p` (0..1), for a p90 without interpolation. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? null;
}
