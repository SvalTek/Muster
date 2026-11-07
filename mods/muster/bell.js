// The topbar bell: one number for everything waiting on a person across every
// project. Pressing it opens the next card that needs an answer.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { liveRuns, needs, nextCard, openCard, subscribe } from "./state.js";
import { alpha, colors, Dot, Icon, R, T } from "./kit.js";

export default class Bell {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render() {
    const k = colors();
    const waiting = needs();
    const live = liveRuns().length;
    const next = nextCard();
    const tone = waiting.length ? k.blocked : live ? k.working : k.dim;

    return h_flex().size_full().items_center().justify_center().bg(k.chrome)
      .child(
        h_flex().id("muster-bell").flex_none().h(28).items_center().gap(5).px(8).rounded(R.control)
          .cursor_pointer().tooltip(next ? `Next: ${next.title}` : "Nothing needs you")
          .bg(waiting.length ? alpha(k.blocked, 0.12) : "transparent")
          .hover((s) => s.bg(waiting.length ? alpha(k.blocked, 0.18) : k.hover))
          .on_click(() => openCard(next))
          .child(Icon("bell", { size: 15, color: tone }))
          .when(waiting.length > 0, (el) =>
            el.child(div().text_size(T.sm).text_color(k.blocked).child(String(waiting.length))),
          )
          .when(waiting.length === 0 && live > 0, (el) => el.child(Dot({ color: k.working, size: 6 }))),
      );
  }
}
