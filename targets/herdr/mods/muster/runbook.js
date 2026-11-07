// Runbooks: the ordered steps a project has agreed to. A runbook is imported
// from markdown, and re-importing keeps step state. Every press moves one step
// through the CLI, so an agent sees the same state the window shows.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { call, refresh, selectedProject, snapshot, subscribe } from "./state.js";
import { Action, age, alpha, colors, Empty, G, Icon, ProjectMark, R, T } from "./kit.js";
import { stateIcon } from "./helpers.js";

function joinPath(root, file) {
  if (/^[A-Za-z]:[\\/]/.test(file) || file.startsWith("\\\\") || file.startsWith("/")) return file;
  return `${root.replace(/[\\/]+$/, "")}/${file.replace(/^[\\/]+/, "")}`;
}

function progressTone(k, done, total) {
  if (!total || done === 0) return k.muted;
  return done === total ? k.done : k.working;
}

export default class Runbook {
  init(_props, cx) {
    this.busy = null;
    this.error = null;
    this.notice = null;
    this.seq = 0;
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  async act(cx, label, work) {
    if (this.busy) return;
    const token = ++this.seq;
    this.busy = label;
    this.error = null;
    this.notice = null;
    cx.notify();
    try {
      await work();
      await refresh(true);
      this.notice = label;
    } catch (error) {
      this.error = String(error?.message ?? error);
    } finally {
      this.busy = null;
      cx.notify();
      cx.timer.after(3200, () => {
        if (this.seq === token && !this.busy) {
          this.notice = null;
          cx.notify();
        }
      });
    }
  }

  sync(cx, project) {
    if (!project?.runbook) return;
    return this.act(cx, `Imported ${project.runbook}`, () =>
      call(["runbook", "import", joinPath(project.root, project.runbook), "--project", project.key]),
    );
  }

  setStep(cx, book, step, state) {
    if (step.state === state) return;
    return this.act(cx, `${book.slug} step ${step.n} ${state}`, () =>
      call(["runbook", "step", String(step.n), state, "--slug", book.slug, "--project", book.projectKey]),
    );
  }

  render(cx) {
    const k = colors();
    const snap = snapshot();
    if (!snap) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_size(T.base).text_color(k.muted).child("Reading runbooks…"));
    }

    const selectedKey = selectedProject(snap);
    const projects = snap.board ?? [];
    const books = snap.runbooks ?? [];
    const selectedProjectRow = projects.find((row) => row.key === selectedKey) ?? null;
    const groups = new Map();
    for (const book of books) {
      const list = groups.get(book.projectKey) ?? [];
      list.push(book);
      groups.set(book.projectKey, list);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => {
      if (a === selectedKey) return -1;
      if (b === selectedKey) return 1;
      return (groups.get(a)?.[0]?.projectName ?? a).localeCompare(groups.get(b)?.[0]?.projectName ?? b);
    });

    const status = this.error
      ? { color: k.blocked, icon: "alert", text: this.error }
      : this.busy
        ? { color: k.working, icon: "clock", text: `${this.busy}…` }
        : this.notice
          ? { color: k.done, icon: "check", text: this.notice }
          : null;

    return v_flex().size_full().min_h(0)
      .child(
        h_flex().flex_none().w_full().items_end().gap(G.md).p(G.lg).pb(G.sm)
          .child(
            v_flex().flex_1().min_w(0).gap(2)
              .child(div().text_size(T.xl).text_color(k.foreground).child("Runbooks"))
              .child(
                div().text_size(T.sm).text_color(k.dim)
                  .child(
                    books.length
                      ? `${books.length} ${books.length === 1 ? "runbook" : "runbooks"} · ${projects.length} ${projects.length === 1 ? "project" : "projects"}`
                      : "No runbooks imported yet",
                  ),
              ),
          )
          .when(Boolean(selectedProjectRow?.runbook), (el) =>
            el.child(
              Action("muster-runbook-sync", "Sync marker", {
                style: "secondary",
                icon: "refresh",
                onPress: () => this.sync(cx, selectedProjectRow),
              }).tooltip(`Re-import ${selectedProjectRow?.runbook}`),
            ),
          )
          .child(
            Action("muster-runbook-refresh", "Refresh", {
              style: "ghost",
              icon: "refresh",
              onPress: () => refresh(true).then(() => cx.notify()).catch(() => cx.notify()),
            }),
          ),
      )
      .when(Boolean(status), (el) =>
        el.child(
          h_flex().flex_none().w_full().items_center().gap(6).px(G.lg).pb(G.sm)
            .child(Icon(status.icon, { size: 12, color: status.color }))
            .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(status.color).tooltip(status.text).child(status.text)),
        ),
      )
      .when(books.length === 0, (el) =>
        el.child(
          Empty({
            icon: "book",
            title: "No runbook yet",
            detail: selectedProjectRow?.runbook
              ? `Add “runbook”: “${selectedProjectRow.runbook}” to .muster.json, then refresh or sync.`
              : "Add a \"runbook\" path to .muster.json, or ask the agent to call muster_runbook_import.",
            action: selectedProjectRow?.runbook
              ? Action("muster-runbook-import", "Import from marker", {
                  style: "primary",
                  icon: "refresh",
                  onPress: () => this.sync(cx, selectedProjectRow),
                })
              : null,
          }),
        ),
      )
      .when(books.length > 0, (el) =>
        el.child(
          v_flex().id("muster-runbooks").flex_1().min_h(0).w_full().overflow_y_scrollbar()
            .px(G.lg).pb(G.lg).gap(G.lg)
            .children(
              ordered.map(([projectKey, projectBooks]) =>
                v_flex().w_full().gap(G.sm)
                  .child(
                    h_flex().w_full().items_center().gap(G.sm)
                      .child(ProjectMark(projectBooks[0]?.projectName ?? projectKey, projectBooks[0]?.color, { size: 20 }))
                      .child(div().text_size(T.sm).text_color(k.foreground).child(projectBooks[0]?.projectName ?? projectKey))
                      .child(div().text_size(T.xs).text_color(k.dim).child(projectKey))
                      .child(div().flex_1())
                      .when(projectKey === selectedKey, (row) =>
                        row.child(div().text_size(T.xs).text_color(k.dim).child("selected")),
                      ),
                  )
                  .children(projectBooks.map((book) => this.book(cx, k, book))),
              ),
            ),
        ),
      );
  }

  book(cx, k, book) {
    const steps = book.steps ?? [];
    const done = steps.filter((step) => step.state === "done").length;
    const skipped = steps.filter((step) => step.state === "skipped").length;
    const total = steps.length;
    const percent = total ? Math.round(((done + skipped) / total) * 100) : 0;
    const tone = progressTone(k, done, total);

    return v_flex().flex_none().w_full().rounded(R.card).border_1().border_color(k.border)
      .bg(k.background).overflow_hidden()
      .child(
        h_flex().w_full().items_center().gap(G.sm).p(G.md)
          .child(
            v_flex().flex_1().min_w(0).gap(2)
              .child(
                h_flex().items_center().gap(7)
                  .child(div().truncate().text_size(T.base).text_color(k.foreground).child(book.title))
                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(book.slug)),
              )
              .child(
                h_flex().items_center().gap(6)
                  .child(
                    div().flex_none().text_size(T.xs).text_color(k.dim)
                      .child(`${done}/${total} done${skipped ? ` · ${skipped} skipped` : ""}`),
                  )
                  .when(Boolean(book.sourcePath), (row) =>
                    row
                      .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
                      .child(
                        div().flex_none().max_w(340).truncate().text_size(T.xs).text_color(k.dim)
                          .tooltip(book.sourcePath).child(book.sourcePath),
                      ),
                  )
                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(`· ${age(book.updatedAt)}`)),
              ),
          )
          .child(
            h_flex().flex_none().w(110).h(4).rounded(2).bg(k.border).overflow_hidden()
              .child(div().h_full().w(`${percent}%`).bg(tone)),
          )
          .child(div().flex_none().w(30).text_size(T.xs).text_color(tone).child(`${percent}%`)),
      )
      .when(steps.length === 0, (el) =>
        el.child(div().px(G.md).pb(G.md).text_size(T.sm).text_color(k.dim).child("This runbook has no steps.")),
      )
      .when(steps.length > 0, (el) =>
        el.child(
          v_flex().w_full()
            .children(
              steps.map((step, index) => {
                const activeTone = step.state === "done" ? k.done : step.state === "blocked" ? k.blocked : step.state === "doing" ? k.working : k.dim;
                const mark = stateIcon(step.state);
                return v_flex().id(`muster-step-${book.projectKey}-${book.slug}-${step.n}`).w_full().gap(4).px(G.md).py(7)
                  .when(index > 0, (row) => row.border_t(1).border_color(k.border))
                  .hover((s) => s.bg(k.hover))
                  .child(
                    h_flex().w_full().items_center().gap(G.sm)
                      .child(
                        div().flex_none().size(18).rounded(5)
                          .bg(alpha(activeTone, 0.12)).flex().items_center().justify_center()
                          .when(Boolean(mark), (tile) => tile.child(Icon(mark, { size: 11, color: activeTone })))
                          .when(!mark, (tile) => tile.child(div().size(5).rounded_full().bg(activeTone))),
                      )
                      .child(div().flex_none().w(18).text_size(T.xs).text_color(k.dim).child(String(step.n)))
                      .child(
                        div().flex_1().min_w(0).truncate().text_size(T.sm)
                          .text_color(step.state === "done" || step.state === "skipped" ? k.muted : k.foreground)
                          .child(step.title),
                      )
                      .when(Boolean(step.command), (row) =>
                        row.child(
                          div().flex_none().max_w(340).truncate().text_size(T.xs).text_color(k.dim)
                            .tooltip(step.command).child(`$ ${step.command.split("\n")[0]}`),
                        ),
                      )
                      .child(div().flex_none().w(4))
                      .child(this.stepAction(k, `${step.n}-doing`, "clock", "Doing", step.state === "doing", () => this.setStep(cx, book, step, "doing")))
                      .child(this.stepAction(k, `${step.n}-done`, "check", "Done", step.state === "done", () => this.setStep(cx, book, step, "done")))
                      .child(this.stepAction(k, `${step.n}-blocked`, "alert", "Blocked", step.state === "blocked", () => this.setStep(cx, book, step, "blocked")))
                      .child(this.stepAction(k, `${step.n}-skipped`, "chevron-right", "Skipped", step.state === "skipped", () => this.setStep(cx, book, step, "skipped")))
                      .child(this.stepAction(k, `${step.n}-todo`, "refresh", "Back to todo", step.state === "todo", () => this.setStep(cx, book, step, "todo"))),
                  )
                  .when(Boolean(step.note), (row) =>
                    row.child(
                      h_flex().w_full().pl(50).gap(6)
                        .child(Icon("cards", { size: 10, color: k.dim }))
                        .child(div().flex_1().min_w(0).text_size(T.xs).text_color(k.dim).child(step.note)),
                    ),
                  );
              }),
            ),
        ),
      );
  }

  stepAction(k, id, icon, tip, active, onPress) {
    return h_flex().id(`muster-step-${id}`).flex_none().size(20).items_center().justify_center()
      .rounded(4).cursor_pointer().tooltip(tip)
      .bg(active ? alpha(k.accent, 0.16) : "transparent")
      .hover((s) => s.bg(active ? alpha(k.accent, 0.22) : k.hover))
      .on_click(() => onPress())
      .child(Icon(icon, { size: 11, color: active ? k.accent : k.dim }));
  }
}
