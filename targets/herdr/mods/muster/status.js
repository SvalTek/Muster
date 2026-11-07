// The status bar: one quiet line. Where the selected project is on the left;
// on the right, only what needs a person speaks up.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  liveRuns,
  needs,
  nextCard,
  openCard,
  projectRow,
  selectedProject,
  select,
  snapshot,
  subscribe,
} from "./state.js";
import { colors, Dot, G, Icon, stateColor, T } from "./kit.js";
import { runLine } from "./helpers.js";

export default class Status {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render() {
    const k = colors();
    const snap = snapshot();
    const key = selectedProject(snap);
    const row = projectRow(key, snap);
    const waiting = needs(snap).length;
    const runs = liveRuns(snap);
    const mine = row ? runs.filter((run) => run.projectId === row.id) : runs;
    const run = mine.sort((a, b) => Date.parse(b.heartbeatAt) - Date.parse(a.heartbeatAt))[0] ?? null;
    const tone = run ? stateColor(run.state, k) : row?.color ?? k.dim;

    return h_flex().size_full().items_center().gap(G.sm).px(G.md).bg(k.chrome)
      .child(
        h_flex().flex_1().min_w(0).items_center().gap(7).cursor_pointer()
          .on_click(() => select("board"))
          .child(Dot({ color: tone, size: 6 }))
          .child(
            div().flex_none().text_size(T.xs).text_color(row ? k.muted : k.dim)
              .child(row?.name ?? "Muster"),
          )
          .when(Boolean(run), (el) =>
            el
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
              .child(div().flex_none().text_size(T.xs).text_color(tone).child(run.state))
              .when(Boolean(runLine(run)), (line) =>
                line
                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
                  .child(
                    div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim)
                      .child(runLine(run)),
                  ),
              ),
          )
          .when(!run && Boolean(row), (el) =>
            el
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("no live run")),
          ),
      )
      .when(waiting > 0, (el) =>
        el.child(
          h_flex().flex_none().items_center().gap(5).h(20).px(6).rounded(4).cursor_pointer()
            .hover((s) => s.bg(k.selected))
            .on_click(() => openCard(nextCard()))
            .child(Icon("bell", { size: 11, color: k.blocked }))
            .child(
              div().text_size(T.xs).text_color(k.blocked)
                .child(`${waiting} ${waiting === 1 ? "need" : "needs"} you`),
            ),
        ),
      )
      .when(waiting === 0 && runs.length > 0, (el) =>
        el.child(
          h_flex().flex_none().items_center().gap(5)
            .child(Dot({ color: k.working, size: 5 }))
            .child(div().text_size(T.xs).text_color(k.dim).child(`${runs.length} live`)),
        ),
      )
      .when(waiting === 0 && runs.length === 0, (el) =>
        el.child(div().flex_none().text_size(T.xs).text_color(k.dim).child("All clear")),
      );
  }
}
