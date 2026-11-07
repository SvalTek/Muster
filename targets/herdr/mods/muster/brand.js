// The sidebar head: Muster's mark, its name, and the one number that matters.
// Clicking the mark goes to the board; clicking the count goes to the next
// card that needs a person.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { needs, nextCard, openCard, select, snapshot, subscribe } from "./state.js";
import { colors, alpha, G, Icon, T } from "./kit.js";

function bars(color) {
  return v_flex().flex_none().gap(2).items_start()
    .child(div().h(2).w(11).rounded(1).bg(color))
    .child(div().h(2).w(8).rounded(1).bg(color))
    .child(div().h(2).w(5).rounded(1).bg(color));
}

export default class Brand {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render() {
    const k = colors();
    const waiting = needs().length;
    const snap = snapshot();
    return h_flex().size_full().items_center().pl(G.md).pr(G.sm).gap(G.sm).bg(k.chrome)
      .child(
        h_flex().id("muster-brand").flex_1().min_w(0).items_center().gap(9).cursor_pointer()
          .on_click(() => select("board"))
          .child(
            div().flex_none().size(24).rounded(7).bg(k.accent)
              .flex().items_center().justify_center()
              .child(bars(k.accentForeground)),
          )
          .child(
            v_flex().min_w(0).gap(0)
              .child(div().truncate().text_size(T.base).font_semibold().text_color(k.foreground).child("Muster"))
              .child(
                div().truncate().text_size(T.xs).text_color(k.dim)
                  .child(snap?.board?.length ? `${snap.board.length} ${snap.board.length === 1 ? "project" : "projects"}` : "attention board"),
              ),
          ),
      )
      .when(waiting > 0, (el) =>
        el.child(
          h_flex().id("muster-brand-needs").flex_none().h(22).items_center().gap(4).px(6).rounded(6)
            .bg(alpha(k.blocked, 0.12)).cursor_pointer().tooltip("Go to the next card that needs you")
            .on_click(() => openCard(nextCard()))
            .child(Icon("bell", { size: 12, color: k.blocked }))
            .child(div().text_size(T.xs).text_color(k.blocked).child(String(waiting))),
        ),
      )
      .when(waiting === 0, (el) =>
        el.child(div().flex_none().px(4).tooltip("Nothing needs you").child(Icon("bell", { size: 14, color: k.dim }))),
      );
  }
}
