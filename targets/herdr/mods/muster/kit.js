// Muster's design kit. Flat warm surfaces, hairline borders, one muted sage
// accent, type doing the hierarchy. Every color comes from Herdr's theme() so
// the light and dark Muster themes both work.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";

/** The spacing rhythm: 4 / 8 / 12 / 16 / 24. */
export const G = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
/** Controls stay tighter than cards. */
export const R = { control: 6, card: 10, pill: 5 };
/** A quiet type scale. */
export const T = { xs: 10.5, sm: 11.5, base: 13, lg: 15, xl: 19 };
/** How long an armed button waits for its confirming press. */
export const ARM_MS = 4000;

export function colors() {
  const t = theme();
  return {
    t,
    background: t.background,
    chrome: t.chrome ?? t.surface,
    canvas: t.canvas ?? t.background,
    surface: t.surface ?? t.background,
    popover: t.popover ?? t.raised ?? t.background,
    raised: t.raised ?? t.hover,
    hover: t.hover,
    selected: t.selected ?? t.hover,
    border: t.border,
    input: t.input ?? t.border,
    foreground: t.foreground,
    muted: t.muted,
    dim: t.dim,
    accent: t.accent,
    accentForeground: t.accent_foreground ?? t.background,
    solid: t.solid ?? t.foreground,
    solidForeground: t.solid_foreground ?? t.background,
    working: t.working,
    blocked: t.blocked,
    done: t.done,
    idle: t.idle,
    unknown: t.unknown ?? t.dim,
  };
}

/** `color` at this opacity, for tints. */
export function alpha(color, a) {
  if (typeof color !== "string" || !color.startsWith("#")) return color;
  const hex = color.slice(0, 7);
  return hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}

/** A stroke icon from icons/, tinted with `color` (else the text color). */
export function Icon(name, { size = 15, color } = {}) {
  const el = svg(`mods/muster/icons/${name}.svg`).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

/** A quiet section label. */
export function Section(label, { right } = {}) {
  const k = colors();
  return h_flex().w_full().flex_none().items_center().justify_between().px(G.md).pt(G.md).pb(G.xs)
    .child(div().text_size(T.xs).text_color(k.dim).child(label))
    .when(Boolean(right), (el) => el.child(right));
}

/** A small state pill. */
export function Pill(text, { tone, bg, label } = {}) {
  const k = colors();
  const color = tone ?? k.muted;
  return h_flex().flex_none().h(18).items_center().px(6).rounded(R.pill)
    .bg(bg ?? alpha(color, 0.12)).text_color(color).text_size(T.xs)
    .child(label ?? text);
}

/** A round mark, used beside project names and run states. */
export function Dot({ color, size = 7 } = {}) {
  const k = colors();
  return div().flex_none().size(size).rounded_full().bg(color ?? k.dim);
}

/** A row action; a danger action arms first and needs a second press. */
export function Action(id, label, {
  style = "secondary",
  onPress,
  armed = false,
  icon = null,
  kbd = null,
  grow = false,
} = {}) {
  const k = colors();
  const palette = armed
    ? { bg: alpha(k.blocked, 0.16), fg: k.blocked, border: k.blocked, hover: alpha(k.blocked, 0.1) }
    : style === "primary"
      ? { bg: k.accent, fg: k.accentForeground, border: k.accent, hover: k.accent }
      : style === "danger"
        ? { bg: "transparent", fg: k.blocked, border: alpha(k.blocked, 0.5), hover: alpha(k.blocked, 0.1) }
        : style === "ghost"
          ? { bg: "transparent", fg: k.muted, border: "transparent", hover: k.hover }
          : { bg: "transparent", fg: k.muted, border: k.border, hover: k.hover };
  return h_flex().id(id).flex_none().h(26).items_center().justify_center().gap(5)
    .px(style === "ghost" ? 6 : 9).rounded(R.control)
    .border_1().border_color(palette.border).bg(palette.bg).text_color(palette.fg)
    .text_size(T.sm).cursor_pointer()
    .hover((s) => s.bg(palette.hover).text_color(style === "primary" ? k.accentForeground : k.foreground))
    .on_click((e, cx) => {
      cx?.stop_propagation?.();
      onPress?.(e, cx);
    })
    .when(Boolean(icon), (el) => el.child(Icon(icon, { size: 13 })))
    .child(div().child(label))
    .when(Boolean(kbd), (el) => el.child(div().text_size(T.xs).text_color(k.dim).child(kbd)))
    .when(grow, (el) => el.flex_1());
}

/** A hairline. */
export function Hairline({ my = 0 } = {}) {
  const k = colors();
  return div().w_full().h(1).flex_none().my(my).bg(k.border);
}

/** The tone a run state wears. */
export function stateColor(state, k = colors()) {
  switch (state) {
    case "working":
      return k.working;
    case "blocked":
    case "failed":
      return k.blocked;
    case "waiting":
      return k.working;
    case "done":
      return k.done;
    case "idle":
    case "idle-unknown":
      return k.idle;
    default:
      return k.unknown;
  }
}

/** A compact age: now, 4m, 3h, 2d. */
export function age(iso, now = Date.now()) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

/** `1 agent`, `3 agents`. */
export function count(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** A scrollable column with the panel's margins. */
export function Scroll(id, { children = [], gap = G.sm, padding = G.md } = {}) {
  return v_flex().id(id).flex_1().min_h(0).w_full().overflow_y_scrollbar()
    .p(padding).gap(gap).children(children);
}

/** A centered empty state. */
export function Empty({ icon = "cards", title, detail, action } = {}) {
  const k = colors();
  return v_flex().size_full().items_center().justify_center().gap(G.sm).p(G.xl)
    .child(Icon(icon, { size: 24, color: k.dim }))
    .child(div().text_size(T.base).text_color(k.muted).child(title ?? "Nothing here yet"))
    .when(Boolean(detail), (el) => el.child(div().max_w(380).text_center().text_size(T.sm).text_color(k.dim).child(detail)))
    .when(Boolean(action), (el) => el.child(action));
}

/** A labelled metric. */
export function Metric(label, value, { color, detail } = {}) {
  const k = colors();
  return v_flex().flex_1().min_w(0).gap(2).px(G.md).py(G.sm)
    .child(div().text_size(T.xs).text_color(k.dim).child(label))
    .child(div().text_size(T.xl).text_color(color ?? k.foreground).child(String(value)))
    .when(Boolean(detail), (el) => el.child(div().text_size(T.sm).text_color(k.muted).child(detail)));
}

/** A project mark: a colored square with the first letter. */
export function ProjectMark(name, color, { size = 22 } = {}) {
  const k = colors();
  return div().flex_none().size(size).rounded(R.control).bg(alpha(color ?? k.accent, 0.16))
    .border_1().border_color(alpha(color ?? k.accent, 0.35))
    .flex().items_center().justify_center().text_size(size < 20 ? T.xs : T.sm)
    .text_color(color ?? k.accent).child((name ?? "?").slice(0, 1).toUpperCase());
}
