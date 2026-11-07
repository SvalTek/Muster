// Stats: the quiet numbers that say whether attention is moving. Counts come
// from the snapshot, the activity series is the last two weeks, and every
// project row is a shortcut back to its cards.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { refresh, select, setCard, setProject, snapshot, subscribe } from "./state.js";
import {
  Action,
  age,
  alpha,
  colors,
  Empty,
  G,
  Icon,
  Metric,
  ProjectMark,
  R,
  T,
} from "./kit.js";

function duration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

function shortDate(date) {
  const parts = String(date).split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
}

function panel(k, title, right, children) {
  return v_flex().flex_none().w_full().rounded(R.card).border_1().border_color(k.border)
    .bg(k.background).overflow_hidden()
    .child(
      h_flex().w_full().items_center().gap(G.sm).px(G.md).py(G.sm).border_b(1).border_color(k.border)
        .child(div().flex_1().text_size(T.xs).text_color(k.dim).child(title))
        .when(Boolean(right), (row) => row.child(right)),
    )
    .child(children);
}

export default class Stats {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render(cx) {
    const k = colors();
    const snap = snapshot();
    if (!snap) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_size(T.base).text_color(k.muted).child("Reading stats…"));
    }

    const stats = snap.stats;
    const totals = stats.totals;
    const response = stats.response;
    const days = stats.windowDays;
    const activity = stats.activity ?? [];
    const peak = activity.reduce((max, day) => Math.max(max, day.count), 0);
    const events = activity.reduce((sum, day) => sum + day.count, 0);
    const projects = stats.projects ?? [];
    const today = new Date().toISOString().slice(0, 10);

    const breakdown = (title, data, tone) => {
      const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
      const max = rows.reduce((top, [, count]) => Math.max(top, count), 0);
      return panel(
        k,
        title,
        div().text_size(T.xs).text_color(k.dim).child(String(rows.reduce((sum, [, count]) => sum + count, 0))),
        v_flex().w_full().p(G.md).gap(6)
          .when(rows.length === 0, (el) => el.child(div().text_size(T.sm).text_color(k.dim).child("Nothing counted yet.")))
          .children(
            rows.map(([label, count]) =>
              h_flex().w_full().items_center().gap(G.sm)
                .child(div().flex_none().w(72).text_size(T.xs).text_color(k.muted).child(label))
                .child(
                  h_flex().flex_1().h(4).rounded(2).bg(k.border).overflow_hidden()
                    .child(div().h_full().w(`${max ? Math.round((count / max) * 100) : 0}%`).bg(tone)),
                )
                .child(div().flex_none().w(26).text_size(T.xs).text_color(k.dim).child(String(count))),
            ),
          ),
      );
    };

    return v_flex().size_full().min_h(0)
      .child(
        h_flex().flex_none().w_full().items_end().gap(G.md).p(G.lg).pb(G.sm)
          .child(
            v_flex().flex_1().min_w(0).gap(2)
              .child(div().text_size(T.xl).text_color(k.foreground).child("Stats"))
              .child(
                div().text_size(T.sm).text_color(k.dim)
                  .child(`${days} day window · ${events} ${events === 1 ? "event" : "events"} · updated ${age(stats.generatedAt)}`),
              ),
          )
          .child(
            Action("muster-stats-refresh", "Refresh", {
              style: "ghost",
              icon: "refresh",
              onPress: () => refresh(true).then(() => cx.notify()).catch(() => cx.notify()),
            }),
          ),
      )
      .child(
        v_flex().id("muster-stats").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(G.lg).pb(G.lg).gap(G.md)
          .child(
            h_flex().w_full().rounded(R.card).border_1().border_color(k.border).bg(k.background).items_center()
              .child(Metric("Need you", totals.cardsNeeds, { color: totals.cardsNeeds > 0 ? k.blocked : k.foreground }))
              .child(div().flex_none().w(1).h(30).bg(k.border))
              .child(Metric("Open cards", totals.cardsOpen))
              .child(div().flex_none().w(1).h(30).bg(k.border))
              .child(Metric("Answered", totals.cardsAnswered, { color: totals.cardsAnswered > 0 ? k.done : k.foreground }))
              .child(div().flex_none().w(1).h(30).bg(k.border))
              .child(Metric("Median answer", duration(response.medianSeconds), { detail: `p90 ${duration(response.p90Seconds)}` }))
              .child(div().flex_none().w(1).h(30).bg(k.border))
              .child(Metric("Live runs", totals.runsLive, { detail: `${totals.agentsBlocked} blocked`, color: totals.agentsBlocked > 0 ? k.blocked : k.foreground }))
              .child(div().flex_none().w(1).h(30).bg(k.border))
              .child(Metric("Projects", totals.projects)),
          )
          .child(
            panel(
              k,
              `Activity · ${days} days`,
              div().text_size(T.xs).text_color(k.dim).child(`${events} total`),
              h_flex().w_full().items_end().gap(4).px(G.md).pt(G.md).pb(G.sm).h(104)
                .children(
                  activity.map((day) => {
                    const height = peak ? Math.max(3, Math.round((day.count / peak) * 62)) : 3;
                    const isToday = day.date === today;
                    return v_flex().id(`muster-activity-${day.date}`).flex_1().min_w(0).items_center().justify_end().gap(4)
                      .tooltip(`${shortDate(day.date)} · ${day.count} ${day.count === 1 ? "event" : "events"}`)
                      .child(
                        div().w_full().h(height).rounded(2)
                          .bg(day.count === 0 ? k.border : isToday ? k.accent : alpha(k.accent, 0.45)),
                      )
                      .child(div().text_size(T.xs).text_color(isToday ? k.muted : k.dim).child(shortDate(day.date)));
                  }),
                ),
            ),
          )
          .child(
            h_flex().w_full().gap(G.md).items_start()
              .child(div().flex_1().min_w(0).child(breakdown("Cards by state", stats.cards.byState, alpha(k.accent, 0.7))))
              .child(div().flex_1().min_w(0).child(breakdown("Cards by kind", stats.cards.byKind, alpha(k.working, 0.7)))),
          )
          .child(
            panel(
              k,
              "Projects",
              div().text_size(T.xs).text_color(k.dim).child(String(projects.length)),
              v_flex().w_full()
                .when(projects.length === 0, (el) =>
                  el.child(
                    Empty({ icon: "board", title: "No projects yet", detail: "Run `muster whoami` in a repository." }),
                  ),
                )
                .children(
                  projects.map((row, index) =>
                    h_flex().id(`muster-stats-project-${row.key}`).w_full().items_center().gap(G.sm).px(G.md).py(7)
                      .when(index > 0, (line) => line.border_t(1).border_color(k.border))
                      .cursor_pointer().hover((s) => s.bg(k.hover))
                      .on_click(() => {
                        setProject(row.key);
                        setCard(null);
                        select("cards");
                      })
                      .child(ProjectMark(row.name, row.color, { size: 20 }))
                      .child(div().flex_1().min_w(0).truncate().text_size(T.sm).text_color(k.foreground).child(row.name))
                      .child(div().flex_none().w(64).text_size(T.xs).text_color(k.dim).child(`${row.open} open`))
                      .child(
                        div().flex_none().w(64).text_size(T.xs).text_color(row.needs > 0 ? k.blocked : k.dim)
                          .child(`${row.needs} needs`),
                      )
                      .child(
                        div().flex_none().w(58).text_size(T.xs).text_color(row.liveRuns > 0 ? k.working : k.dim)
                          .child(`${row.liveRuns} live`),
                      )
                      .child(
                        div().flex_none().w(74).text_size(T.xs).text_color(row.answered > 0 ? k.done : k.dim)
                          .child(`${row.answered} answered`),
                      )
                      .child(div().flex_none().w(40).text_size(T.xs).text_color(k.dim).child(age(row.lastAt)))
                      .child(Icon("chevron-right", { size: 12, color: k.dim })),
                  ),
                ),
            ),
          ),
      );
  }
}
