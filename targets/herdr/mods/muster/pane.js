// A terminal's header in the Muster layout: the project the pane's folder
// belongs to, its branch, the agent's live state, and the pane controls that
// stay out of the way until the pointer arrives.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run } from "herdr";
import { liveRuns, select, setProject, snapshot, subscribe } from "./state.js";
import { colors, Dot, Icon, ProjectMark, R, stateColor, T } from "./kit.js";import { shortHome } from "./helpers.js";

const clean = (path) => (path ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();

function projectFor(rows, cwd) {
  const here = clean(cwd);
  if (!here) return null;
  let best = null;
  for (const row of rows) {
    const root = clean(row.root);
    if (!root) continue;
    if (here === root || here.startsWith(`${root}/`)) {
      if (!best || root.length > clean(best.root).length) best = row;
    }
  }
  return best;
}

export default class Pane {
  init(_props, cx) {
    this.hovered = false;
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  me() {
    return panes().find((pane) => pane.pane === props()?.pane) ?? null;
  }

  button(k, id, icon, tip, onPress) {
    return h_flex().id(id).flex_none().size(20).items_center().justify_center().rounded(4)
      .cursor_pointer().tooltip(tip).hover((s) => s.bg(k.hover))
      .on_click((_event, cx) => {
        cx?.stop_propagation?.();
        onPress();
      })
      .child(Icon(icon, { size: 12, color: k.muted }));
  }

  render() {
    const k = colors();
    const pane = this.me();
    if (!pane) return div();
    const snap = snapshot();
    const row = snap ? projectFor(snap.board ?? [], pane.cwd) : null;
    const run = row ? liveRuns(snap).filter((entry) => entry.projectId === row.id).sort((a, b) => Date.parse(b.heartbeatAt) - Date.parse(a.heartbeatAt))[0] ?? null : null;
    const tone = run ? stateColor(run.state, k) : row?.color ?? k.dim;
    const title = pane.program?.agent || pane.program?.shell ? pane.program?.name : pane.title || pane.program?.name || pane.mod || "shell";

    return h_flex().id(`muster-pane-${pane.pane}`).size_full().px(10).gap(7).items_center()
      .bg(k.background).border_b(1).border_color(k.border).text_size(T.sm)
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: pane.pane }))
      .when(Boolean(row), (el) =>
        el
          .child(ProjectMark(row.name, row.color, { size: 18 }))
          .child(
            h_flex().flex_none().items_center().gap(5).cursor_pointer().tooltip("Open this project's cards")
              .on_click((_event, cx) => {
                cx?.stop_propagation?.();
                setProject(row.key);
                select("cards");
              })
              .child(div().text_size(T.sm).text_color(k.foreground).child(row.name)),
          )
          .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(row.key)),
      )
      .when(!row, (el) =>
        el
          .child(Icon("terminal", { size: 13, color: k.dim }))
          .child(div().flex_none().max_w(180).truncate().text_color(k.foreground).child(title)),
      )
      .child(
        div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim)
          .tooltip(pane.cwd ?? "")
          .child(shortHome(pane.cwd ?? "")),
      )
      .when(Boolean(row?.branch), (el) =>
        el.child(
          h_flex().flex_none().h(18).items_center().gap(4).px(6).rounded(R.pill).bg(k.raised)
            .text_color(k.dim).text_size(T.xs)
            .child(Icon("branch", { size: 10, color: k.dim }))
            .child(div().max_w(160).truncate().child(row.branch)),
        ),
      )
      .when(Boolean(run), (el) =>
        el
          .child(Dot({ color: tone, size: 6 }))
          .child(
            div().flex_none().max_w(220).truncate().text_size(T.xs).text_color(tone).tooltip(run.summary ?? run.state)
              .child(run.summary || run.state),
          ),
      )
      .when(this.hovered, (el) =>
        el.child(
          h_flex().flex_none().gap(1).items_center()
            .child(this.button(k, `muster-pane-${pane.pane}-right`, "split-right", "Split right", () => run("pane.split", { direction: "right", pane: pane.pane })))
            .child(this.button(k, `muster-pane-${pane.pane}-down`, "split-down", "Split down", () => run("pane.split", { direction: "down", pane: pane.pane })))
            .child(this.button(k, `muster-pane-${pane.pane}-zoom`, "maximize", "Zoom", () => run("pane.zoom", { pane: pane.pane })))
            .child(this.button(k, `muster-pane-${pane.pane}-close`, "x", "Close", () => run("pane.close", { pane: pane.pane }))),
        ),
      );
  }
}
