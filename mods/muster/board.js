// The attention board: every project Muster knows, what is live, what waits,
// and the one move that clears the most. Rows are quiet until a count needs a
// person, then the action earns the accent.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome } from "herdr";
import {
  openCardId,
  refresh,
  selectedProject,
  select,
  setCard,
  setProject,
  snapshot,
  subscribe,
} from "./state.js";
import {
  Action,
  age,
  alpha,
  colors,
  Empty,
  G,
  Icon,
  Metric,
  Pill,
  ProjectMark,
  R,
  T,
} from "./kit.js";
import { verbFor } from "./helpers.js";

function openProject(row) {
  setProject(row.key);
  setCard(null);
  select("cards");
}

function nextMove(row) {
  if (row.next?.cardId) openCardId(row.key, row.next.cardId);
  else openProject(row);
}

export default class Board {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render(cx) {
    const k = colors();
    const snap = snapshot();
    const current = selectedProject(snap);
    const rows = snap?.board ?? [];
    const totals = snap?.stats?.totals;
    const days = snap?.stats?.windowDays ?? 14;
    const needs = rows.reduce((sum, row) => sum + row.needs, 0);
    const live = rows.reduce((sum, row) => sum + row.liveRuns, 0);

    if (!snap) {
      return v_flex().size_full().items_center().justify_center().gap(G.sm)
        .child(div().text_size(T.base).text_color(k.muted).child("Reading the board…"));
    }

    return v_flex().size_full().min_h(0)
      .child(
        h_flex().flex_none().w_full().items_end().gap(G.md).p(G.lg).pb(G.sm)
          .child(
            v_flex().flex_1().min_w(0).gap(2)
              .child(div().text_size(T.xl).text_color(k.foreground).child("Attention board"))
              .child(
                div().text_size(T.sm).text_color(k.dim)
                  .child(
                    rows.length
                      ? `${rows.length} ${rows.length === 1 ? "project" : "projects"} · ${needs} ${needs === 1 ? "need" : "needs"} · ${live} live`
                      : "Nothing has reported yet",
                  ),
              ),
          )
          .child(
            Action("board-refresh", "Refresh", {
              style: "ghost",
              icon: "refresh",
              onPress: () => refresh(true).then(() => cx.notify()).catch(() => cx.notify()),
            }),
          ),
      )
      .when(Boolean(totals), (el) =>
        el.child(
          h_flex().flex_none().mx(G.lg).mb(G.md).rounded(R.card).border_1().border_color(k.border)
            .bg(k.background).items_center()
            .child(Metric("Need you", totals.cardsNeeds, { color: totals.cardsNeeds > 0 ? k.blocked : k.foreground }))
            .child(div().flex_none().w(1).h(30).bg(k.border))
            .child(Metric("Open cards", totals.cardsOpen))
            .child(div().flex_none().w(1).h(30).bg(k.border))
            .child(Metric("Live runs", totals.runsLive, { detail: `${totals.agentsWorking} working` }))
            .child(div().flex_none().w(1).h(30).bg(k.border))
            .child(Metric("Answered", totals.cardsAnswered, { detail: `${days}d window`, color: totals.cardsAnswered > 0 ? k.done : k.foreground })),
        ),
      )
      .when(rows.length === 0, (el) =>
        el.child(
          Empty({
            icon: "board",
            title: "No projects yet",
            detail: "Run `muster whoami` inside a repository, or point an agent at Muster over MCP, then refresh.",
          }),
        ),
      )
      .when(rows.length > 0, (el) =>
        el.child(
          v_flex().id("muster-board").flex_1().min_h(0).w_full().overflow_y_scrollbar()
            .px(G.lg).pb(G.lg).gap(G.sm)
            .children(
              rows.map((row) => {
                const focused = row.key === current;
                const next = row.next ?? { kind: "clear", label: "Nothing needs you" };
                return v_flex().id(`muster-board-${row.key}`).flex_none().w_full().gap(7).p(G.md)
                  .rounded(R.card).cursor_pointer()
                  .border_1().border_color(focused ? alpha(row.color, 0.45) : k.border)
                  .bg(focused ? k.hover : k.background)
                  .hover((s) => s.bg(k.hover).border_color(alpha(row.color, 0.45)))
                  .on_click(() => openProject(row))
                  .child(
                    h_flex().w_full().items_center().gap(G.sm)
                      .child(ProjectMark(row.name, row.color, { size: 26 }))
                      .child(
                        v_flex().flex_1().min_w(0).gap(0)
                          .child(div().truncate().text_size(T.base).text_color(k.foreground).child(row.name))
                          .child(div().truncate().text_size(T.xs).text_color(k.dim).child(row.key)),
                      )
                      .when(Boolean(row.branch), (meta) =>
                        meta.child(
                          h_flex().flex_none().h(18).items_center().gap(4).px(6).rounded(R.pill)
                            .bg(k.raised).text_color(k.dim).text_size(T.xs)
                            .child(Icon("branch", { size: 11, color: k.dim }))
                            .child(div().max_w(180).truncate().child(row.branch)),
                        ),
                      )
                      .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(age(row.lastAt)))
                      .child(Icon("chevron-right", { size: 13, color: k.dim })),
                  )
                  .child(
                    h_flex().w_full().items_center().gap(10).pl(34)
                      .when(row.needs > 0, (line) => line.child(Pill(`${row.needs} ${row.needs === 1 ? "need" : "needs"}`, { tone: k.blocked })))
                      .child(div().flex_none().text_size(T.xs).text_color(k.muted).child(`${row.openCards} open`))
                      .when(row.liveRuns > 0, (line) =>
                        line
                          .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
                          .child(div().flex_none().text_size(T.xs).text_color(k.working).child(`${row.liveRuns} live`)),
                      )
                      .when(row.answeredWindow > 0, (line) =>
                        line
                          .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
                          .child(div().flex_none().text_size(T.xs).text_color(k.done).child(`${row.answeredWindow} answered`)),
                      )
                      .child(div().flex_1().min_w(0))
                      .child(
                        div().flex_none().max_w(280).truncate().text_size(T.xs).text_color(k.muted)
                          .tooltip(next.label).child(next.label),
                      )
                      .child(
                        Action(`muster-board-next-${row.key}`, verbFor(next.kind), {
                          style: row.needs > 0 ? "primary" : "secondary",
                          icon: next.kind === "answer" ? "inbox" : next.kind === "unblock" ? "alert" : next.kind === "review" ? "cards" : "chevron-right",
                          onPress: () => nextMove(row),
                        }),
                      ),
                  );
              }),
            ),
        ),
      )
      .child(
        h_flex().flex_none().w_full().px(G.lg).py(G.sm).border_t(1).border_color(k.border)
          .items_center().gap(G.sm)
          .child(Icon("terminal", { size: 12, color: k.dim }))
          .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim).child(appHome()))
          .child(div().text_size(T.xs).text_color(k.dim).child("Ctrl+Shift+M next · Ctrl+Shift+R refresh")),
      );
  }
}
