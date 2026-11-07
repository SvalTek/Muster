// The sidebar: the five places Muster shows, every project it knows, and the
// runs that are live right now. Rows are quiet until a number needs you.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  activeView,
  liveRuns,
  needs,
  selectedProject,
  select,
  setCard,
  setProject,
  snapshot,
  subscribe,
} from "./state.js";
import { age, colors, count, Dot, G, Icon, Pill, ProjectMark, R, T } from "./kit.js";

function navRow(k, active, icon, label, badge, onPress) {
  return h_flex().id(`muster-nav-${label.toLowerCase()}`).flex_none().h(28).items_center().gap(9)
    .px(8).rounded(R.control).cursor_pointer()
    .bg(active ? k.selected : "transparent")
    .hover((s) => s.bg(active ? k.selected : k.hover))
    .on_click(onPress)
    .child(Icon(icon, { size: 14, color: active ? k.foreground : k.muted }))
    .child(div().flex_1().min_w(0).truncate().text_size(T.sm).text_color(active ? k.foreground : k.muted).child(label))
    .when(badge > 0, (el) => el.child(div().text_size(T.xs).text_color(k.dim).child(String(badge))));
}

export default class Sidebar {
  init(_props, cx) {
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  render() {
    const k = colors();
    const snap = snapshot();
    const active = activeView();
    const key = selectedProject(snap);
    const waiting = needs(snap).length;
    const cards = (snap?.cards ?? []).filter((card) => ["open", "claimed"].includes(card.state));
    const runs = liveRuns(snap);
    const projects = snap?.board ?? [];
    const books = snap?.runbooks ?? [];

    return v_flex().size_full().min_h(0).bg(k.chrome)
      .child(
        v_flex().flex_none().p(G.xs + 2).gap(1)
          .child(navRow(k, active === "board", "board", "Board", 0, () => select("board")))
          .child(navRow(k, active === "cards", "cards", "Cards", waiting || cards.length, () => select("cards")))
          .child(navRow(k, active === "runbook", "book", "Runbook", books.length, () => select("runbook")))
          .child(navRow(k, active === "stats", "chart", "Stats", 0, () => select("stats")))
          .child(navRow(k, active === "work", "terminal", "Terminals", runs.length, () => select("work"))),
      )
      .child(div().flex_none().h(1).mx(G.md).bg(k.border))
      .child(
        h_flex().flex_none().items_center().justify_between().px(G.md).pt(G.md).pb(G.xs)
          .child(div().text_size(T.xs).text_color(k.dim).child("Projects"))
          .child(div().text_size(T.xs).text_color(k.dim).child(String(projects.length))),
      )
      .child(
        v_flex().id("muster-projects").flex_1().min_h(0).overflow_y_scrollbar().px(G.xs + 2).pb(G.sm).gap(1)
          .when(projects.length === 0, (el) =>
            el.child(
              div().px(G.sm).py(G.sm).text_size(T.sm).text_color(k.dim)
                .child("Open a repository and run `muster whoami`, then refresh."),
            ),
          )
          .children(
            projects.map((row) => {
              const current = row.key === key;
              return h_flex().id(`muster-project-${row.key}`).flex_none().items_center().gap(G.sm)
                .px(7).py(6).rounded(R.control).cursor_pointer()
                .bg(current ? k.selected : "transparent")
                .hover((s) => s.bg(current ? k.selected : k.hover))
                .on_click(() => {
                  setProject(row.key);
                  setCard(null);
                  select("cards");
                })
                .child(ProjectMark(row.name, row.color, { size: 20 }))
                .child(
                  v_flex().flex_1().min_w(0).gap(1)
                    .child(div().truncate().text_size(T.sm).text_color(current ? k.foreground : k.muted).child(row.name))
                    .child(
                      div().truncate().text_size(T.xs).text_color(k.dim)
                        .child(row.branch ?? row.next?.label ?? row.source),
                    ),
                )
                .when(row.needs > 0, (el) => el.child(Pill(String(row.needs), { tone: k.blocked })))
                .when(row.needs === 0 && row.liveRuns > 0, (el) =>
                  el.child(div().flex_none().pr(2).child(Dot({ color: k.working }))),
                )
                .when(row.needs === 0 && row.liveRuns === 0, (el) =>
                  el.child(div().flex_none().text_size(T.xs).text_color(k.dim).child(age(row.lastAt))),
                );
            }),
          ),
      )
      .when(runs.length > 0, (el) =>
        el
          .child(div().flex_none().h(1).mx(G.md).bg(k.border))
          .child(
            v_flex().flex_none().px(G.md).pt(G.sm).pb(G.xs).gap(1)
              .child(
                h_flex().flex_none().items_center().justify_between()
                  .child(div().text_size(T.xs).text_color(k.dim).child("Live runs"))
                  .child(div().text_size(T.xs).text_color(k.dim).child(String(runs.length))),
              )
              .children(
                runs.slice(0, 4).map((run) => {
                  const project = projects.find((row) => row.id === run.projectId);
                  return h_flex().id(`muster-run-${run.id}`).flex_none().items_center().gap(7).py(3)
                    .cursor_pointer().rounded(R.control).hover((s) => s.bg(k.hover))
                    .on_click(() => {
                      if (project) {
                        setProject(project.key);
                        select("work");
                      }
                    })
                    .child(Dot({ color: run.state === "blocked" ? k.blocked : run.state === "done" ? k.done : k.working, size: 6 }))
                    .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.muted).child(run.agent ?? run.terminal ?? "agent"))
                    .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(count(project?.liveRuns ?? 0, "run")))
                    .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(age(run.heartbeatAt)));
                }),
              ),
          ),
      )
      .child(div().flex_none().h(G.sm));
  }
}
