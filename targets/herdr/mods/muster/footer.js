// The sidebar footer: where Muster keeps its data, the version, and one way to
// force a fresh snapshot. When the service cannot be reached the error takes
// the footer over, because that is the only thing that matters then.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome } from "herdr";
import { lastError, refresh, snapshot, subscribe } from "./state.js";
import { alpha, colors, Dot, G, Icon, R, T } from "./kit.js";
import { baseName, shortHome } from "./helpers.js";

function refreshButton(k, cx) {
  return h_flex().id("muster-footer-refresh").flex_none().size(22).items_center().justify_center()
    .rounded(R.control).cursor_pointer().tooltip("Refresh now (Ctrl+Shift+R)")
    .hover((s) => s.bg(k.hover))
    .on_click(() => refresh(true).then(() => cx.notify()).catch(() => cx.notify()))
    .child(Icon("refresh", { size: 13, color: k.muted }));
}

export default class Footer {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render(cx) {
    const k = colors();
    const snap = snapshot();
    const error = lastError();
    const failed = Boolean(error);

    return v_flex().size_full().justify_center().gap(3).px(G.md).bg(k.chrome)
      .border_t(1).border_color(k.border)
      .when(failed, (el) =>
        el
          .child(
            h_flex().flex_none().items_center().gap(6)
              .child(Icon("alert", { size: 12, color: k.blocked }))
              .child(div().text_size(T.sm).text_color(k.blocked).child("Muster service unreachable"))
              .child(div().flex_1())
              .child(refreshButton(k, cx)),
          )
          .child(div().flex_none().truncate().text_size(T.xs).text_color(k.dim).tooltip(error).child(error)),
      )
      .when(!failed, (el) =>
        el
          .child(
            h_flex().flex_none().items_center().gap(6)
              .child(Dot({ color: k.done, size: 6 }))
              .child(div().text_size(T.sm).text_color(k.muted).child("Local"))
              .child(div().text_size(T.xs).text_color(k.dim).child("·"))
              .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim).tooltip(snap?.db ?? "").child(baseName(snap?.db) || "muster.db"))
              .child(refreshButton(k, cx)),
          )
          .child(
            h_flex().flex_none().items_center().gap(6)
              .child(
                div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim)
                  .tooltip(snap?.home ?? appHome())
                  .child(shortHome(snap?.home ?? appHome())),
              )
              .when(Boolean(snap?.musterVersion), (row) =>
                row.child(
                  div().flex_none().px(4).py(1).rounded(4).bg(alpha(k.accent, 0.1))
                    .text_size(T.xs).text_color(k.muted).child(`v${snap.musterVersion}`),
                ),
              ),
          ),
      );
  }
}
