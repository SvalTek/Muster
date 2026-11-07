// Cards: the durable things agents put in front of a person. The left column
// is the attention-ordered list for this project; the right column is the card
// itself, its answer, artifacts and the buttons that move it. Every button
// calls the CLI, then rereads the snapshot, so the window never invents state.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, TextView } from "gpui-base";
import {
  call,
  refresh,
  selectedCard,
  selectedProject,
  setCard,
  setProject,
  snapshot,
  subscribe,
} from "./state.js";
import {
  Action,
  age,
  alpha,
  ARM_MS,
  colors,
  Empty,
  G,
  Icon,
  Pill,
  ProjectMark,
  R,
  T,
} from "./kit.js";
import { cardTone, kindIcon, openExternal, stateIcon } from "./helpers.js";

const FILTERS = [
  {
    id: "needs",
    label: "Needs",
    match: (card) =>
      ["open", "claimed"].includes(card.state) &&
      (["question", "approval"].includes(card.kind) || ["blocked", "attention"].includes(card.severity)),
  },
  { id: "open", label: "Open", match: (card) => ["open", "claimed"].includes(card.state) },
  { id: "answered", label: "Answered", match: (card) => card.state === "answered" },
  { id: "all", label: "All", match: () => true },
];

function stateTone(state, k) {
  switch (state) {
    case "answered":
    case "resolved":
      return k.done;
    case "claimed":
    case "doing":
      return k.working;
    case "dismissed":
    case "expired":
      return k.dim;
    default:
      return k.muted;
  }
}

function severityTone(severity, k) {
  if (severity === "blocked") return k.blocked;
  if (severity === "attention") return k.working;
  if (severity === "success") return k.done;
  return k.muted;
}

function refValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default class Cards {
  init(_props, cx) {
    this.filter = "open";
    this.busy = null;
    this.error = null;
    this.notice = null;
    this.armed = null;
    this.inputCard = null;
    this.seq = 0;
    this.answer = InputState.new({ placeholder: "Type an answer and press Enter" });
    this.answer.on("submit", (_event, cx) => this.submitText(cx));
    this.sub = subscribe(cx, () => cx.notify());
  }

  close() {
    this.sub?.stop();
  }

  /** Runs one CLI call, then refreshes; one at a time, with a visible outcome. */
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

  arm(cx, key) {
    this.armed = key;
    cx.notify();
    cx.timer.after(ARM_MS, () => {
      if (this.armed === key) {
        this.armed = null;
        cx.notify();
      }
    });
  }

  answerAction(cx, card, action) {
    if (this.busy) return;
    const key = `${card.id}:${action.id}`;
    if (action.confirm && this.armed !== key) {
      this.arm(cx, key);
      return;
    }
    this.armed = null;
    return this.act(cx, `Answered “${action.label}”`, () =>
      call(["card", "answer", card.id, "--action", action.id]),
    );
  }

  submitText(cx) {
    if (this.busy) return;
    const text = this.answer.value().trim();
    const card = this.detailCard();
    if (!card || !text) return;
    this.answer.set_value("");
    return this.act(cx, "Answered", () => call(["card", "answer", card.id, "--text", text]));
  }

  resolve(cx, card) {
    return this.act(cx, "Resolved", async () => {
      await call(["card", "resolve", card.id, "--resolution", "Resolved in Muster"]);
      setCard(null);
    });
  }

  dismiss(cx, card) {
    if (this.busy) return;
    const key = `${card.id}:dismiss`;
    if (this.armed !== key) {
      this.arm(cx, key);
      return;
    }
    this.armed = null;
    return this.act(cx, "Dismissed", async () => {
      await call(["card", "dismiss", card.id]);
      setCard(null);
    });
  }

  detailCard() {
    const id = selectedCard();
    return id ? (snapshot()?.cards ?? []).find((card) => card.id === id) ?? null : null;
  }

  render(cx) {
    const k = colors();
    const snap = snapshot();

    if (!snap) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_size(T.base).text_color(k.muted).child("Reading cards…"));
    }

    const projectKey = selectedProject(snap);
    const project = (snap.board ?? []).find((row) => row.key === projectKey) ?? null;
    const scope = projectKey
      ? (snap.cards ?? []).filter((card) => card.project?.key === projectKey)
      : (snap.cards ?? []);
    const counts = Object.fromEntries(FILTERS.map((filter) => [filter.id, scope.filter(filter.match).length]));
    const filter = FILTERS.find((entry) => entry.id === this.filter) ?? FILTERS[1];
    const rows = scope.filter(filter.match);
    const selected = selectedCard(snap);
    const detail = (selected ? scope.find((card) => card.id === selected) : null) ?? rows[0] ?? null;

    if (detail && this.inputCard !== detail.id) {
      this.answer.set_value("");
      this.inputCard = detail.id;
    }

    const filterTab = (entry) =>
      h_flex().id(`muster-cards-filter-${entry.id}`).flex_none().h(24).items_center().gap(5).px(8)
        .rounded(4).cursor_pointer()
        .bg(this.filter === entry.id ? k.selected : "transparent")
        .hover((s) => s.bg(this.filter === entry.id ? k.selected : k.hover))
        .on_click(() => {
          this.filter = entry.id;
          cx.notify();
        })
        .child(div().text_size(T.xs).text_color(this.filter === entry.id ? k.foreground : k.muted).child(entry.label))
        .child(div().text_size(T.xs).text_color(k.dim).child(String(counts[entry.id] ?? 0)));

    return v_flex().size_full().min_h(0)
      .child(
        h_flex().flex_none().w_full().items_end().gap(G.md).p(G.lg).pb(G.sm)
          .child(
            v_flex().flex_1().min_w(0).gap(2)
              .child(div().text_size(T.xl).text_color(k.foreground).child("Cards"))
              .child(
                div().text_size(T.sm).text_color(k.dim)
                  .child(project ? `${project.name} · ${rows.length} shown` : `${rows.length} cards`),
              ),
          )
          .child(
            h_flex().flex_none().gap(1).p(2).rounded(R.control).bg(k.raised)
              .children(FILTERS.map(filterTab)),
          )
          .child(
            Action("muster-cards-refresh", "Refresh", {
              style: "ghost",
              icon: "refresh",
              onPress: () => refresh(true).then(() => cx.notify()).catch(() => cx.notify()),
            }),
          ),
      )
      .child(
        h_flex().flex_1().min_h(0).w_full().border_t(1).border_color(k.border)
          // The list.
          .child(
            v_flex().w(342).flex_none().min_h(0).h_full().border_r(1).border_color(k.border)
              .when(rows.length === 0, (el) =>
                el.child(
                  v_flex().flex_1().items_center().justify_center().gap(G.sm).p(G.lg)
                    .child(Icon("cards", { size: 20, color: k.dim }))
                    .child(
                      div().text_size(T.sm).text_color(k.muted).text_center()
                        .child(this.filter === "needs" ? "Nothing needs you" : "No cards here"),
                    ),
                ),
              )
              .when(rows.length > 0, (el) =>
                el.child(
                  v_flex().id("muster-cards-list").flex_1().min_h(0).overflow_y_scrollbar().py(G.xs)
                    .children(
                      rows.map((card) => {
                        const active = detail?.id === card.id;
                        const tone = cardTone(card, k);
                        return h_flex().id(`muster-cards-row-${card.id}`).w_full().flex_none().items_start().gap(9)
                          .px(G.md).py(7).cursor_pointer()
                          .bg(active ? k.selected : "transparent")
                          .border_l(2).border_color(active ? tone : "transparent")
                          .hover((s) => s.bg(active ? k.selected : k.hover))
                          .on_click(() => {
                            setCard(card.id);
                            if (card.project?.key) setProject(card.project.key);
                            cx.notify();
                          })
                          .child(
                            div().flex_none().size(20).rounded(5).bg(alpha(tone, 0.12))
                              .flex().items_center().justify_center()
                              .child(Icon(kindIcon(card.kind), { size: 12, color: tone })),
                          )
                          .child(
                            v_flex().flex_1().min_w(0).gap(2)
                              .child(
                                div().truncate().text_size(T.sm)
                                  .text_color(card.state === "answered" || card.state === "resolved" ? k.muted : k.foreground)
                                  .child(card.title),
                              )
                              .child(
                                h_flex().gap(4).min_w(0).items_center()
                                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(card.project?.name ?? ""))
                                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
                                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(card.kind))
                                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
                                  .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(age(card.updatedAt))),
                              ),
                          )
                          .when(Boolean(stateIcon(card.state)), (el) =>
                            el.child(Icon(stateIcon(card.state), { size: 12, color: stateTone(card.state, k) })),
                          );
                      }),
                    ),
                ),
              ),
          )
          // The card.
          .child(
            v_flex().flex_1().min_w(0).min_h(0)
              .when(!detail, (el) =>
                el.child(
                  Empty({
                    icon: "cards",
                    title: "Pick a card",
                    detail: "Choose one on the left, or press Ctrl+Shift+M to jump to the next thing that needs you.",
                  }),
                ),
              )
              .when(Boolean(detail), (el) => el.child(this.card(cx, detail, snap))),
          ),
      );
  }

  card(cx, card, snap) {
    const k = colors();
    const closed = ["resolved", "dismissed", "expired"].includes(card.state);
    const canAnswer = ["open", "claimed", "answered"].includes(card.state);
    const tone = cardTone(card, k);
    const chosen = card.answer?.actionId
      ? card.actions.find((action) => action.id === card.answer.actionId) ?? null
      : null;
    const artifacts = (snap.artifacts ?? []).filter((artifact) => artifact.cardId === card.id);
    const refs = Object.entries(card.refs ?? {});
    const needsText = canAnswer && (["question", "approval"].includes(card.kind) || card.actions.length === 0);

    const status = this.error
      ? { color: k.blocked, icon: "alert", text: this.error }
      : this.busy
        ? { color: k.working, icon: "clock", text: `${this.busy}…` }
        : this.notice
          ? { color: k.done, icon: "check", text: this.notice }
          : null;

    return v_flex().flex_1().min_h(0).min_w(0)
      .child(
        v_flex().flex_none().gap(7).p(G.lg).pb(G.md).border_b(1).border_color(k.border)
          .child(
            h_flex().w_full().items_center().gap(7)
              .child(ProjectMark(card.project?.name ?? "?", card.project?.color, { size: 20 }))
              .child(div().flex_none().text_size(T.sm).text_color(k.muted).child(card.project?.name ?? ""))
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
              .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim).child(card.project?.key ?? ""))
              .child(Pill(card.state, { tone: stateTone(card.state, k) }))
              .child(Pill(card.kind, { tone: k.muted }))
              .when(card.severity !== "info", (el) =>
                el.child(Pill(card.severity, { tone: severityTone(card.severity, k) })),
              ),
          )
          .child(div().w_full().text_size(T.lg).text_color(k.foreground).child(card.title))
          .child(
            h_flex().w_full().gap(6).items_center()
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(card.id))
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(`created ${age(card.createdAt)}`))
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child("·"))
              .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(`updated ${age(card.updatedAt)}`))
              .child(div().flex_1()),
          ),
      )
      .child(
        v_flex().id("muster-card-body").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(G.lg).py(G.md).gap(G.md)
          .when(Boolean(card.body), (el) =>
            el.child(
              div().w_full().text_size(T.base).text_color(k.foreground)
                .child(TextView.markdown(`muster-card-markdown-${card.id}`, card.body).selectable(true)),
            ),
          )
          .when(!card.body, (el) =>
            el.child(div().text_size(T.sm).text_color(k.dim).child("No detail on this card.")),
          )
          .when(refs.length > 0, (el) =>
            el
              .child(this.label(k, "Refs"))
              .child(
                h_flex().w_full().gap(6).flex_wrap()
                  .children(
                    refs.map(([key, value]) =>
                      h_flex().flex_none().max_w(420).h(22).items_center().gap(5).px(7).rounded(R.pill)
                        .border_1().border_color(k.border).bg(k.raised)
                        .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(key))
                        .child(
                          div().truncate().text_size(T.xs).text_color(k.muted)
                            .tooltip(refValue(value)).child(refValue(value)),
                        ),
                    ),
                  ),
              ),
          )
          .when(artifacts.length > 0, (el) =>
            el
              .child(this.label(k, "Artifacts"))
              .child(
                v_flex().w_full().gap(3)
                  .children(
                    artifacts.map((artifact) =>
                      h_flex().id(`muster-artifact-${artifact.id}`).w_full().items_center().gap(8)
                        .px(8).py(6).rounded(R.control).cursor_pointer()
                        .hover((s) => s.bg(k.hover))
                        .on_click(() => openExternal(artifact.url ?? artifact.path))
                        .child(Icon(artifact.kind === "url" ? "arrow-up-right" : "book", { size: 12, color: k.accent }))
                        .child(div().flex_none().text_size(T.sm).text_color(k.foreground).child(artifact.title))
                        .child(
                          div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(k.dim)
                            .tooltip(artifact.path ?? artifact.url ?? "")
                            .child(artifact.path ?? artifact.url ?? ""),
                        )
                        .when(Boolean(artifact.mime), (meta) =>
                          meta.child(div().flex_none().text_size(T.xs).text_color(k.dim).child(artifact.mime)),
                        ),
                    ),
                  ),
              ),
          )
          .when(Boolean(card.answer), (el) =>
            el
              .child(this.label(k, "Answer"))
              .child(
                v_flex().w_full().gap(4).p(G.md).rounded(R.control)
                  .border_1().border_color(alpha(k.done, 0.4)).bg(alpha(k.done, 0.06))
                  .child(
                    div().text_size(T.xs).text_color(k.dim)
                      .child(
                        `${card.answer.by ? `${card.answer.by} · ` : ""}answered ${age(card.answeredAt ?? card.updatedAt)}`,
                      ),
                  )
                  .when(Boolean(chosen), (body) =>
                    body.child(div().text_size(T.base).text_color(k.foreground).child(chosen.label)),
                  )
                  .when(!chosen && Boolean(card.answer.text), (body) =>
                    body.child(div().text_size(T.base).text_color(k.foreground).child(card.answer.text)),
                  )
                  .when(Boolean(card.answer.note), (body) =>
                    body.child(div().text_size(T.sm).text_color(k.muted).child(card.answer.note)),
                  ),
              ),
          ),
      )
      .child(
        v_flex().flex_none().w_full().border_t(1).border_color(k.border).px(G.md).py(G.sm).gap(6)
          .when(Boolean(status), (el) =>
            el.child(
              h_flex().w_full().items_center().gap(6)
                .child(Icon(status.icon, { size: 12, color: status.color }))
                .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(status.color).tooltip(status.text).child(status.text)),
            ),
          )
          .when(needsText && !closed, (el) =>
            el.child(
              h_flex().w_full().items_center().gap(6)
                .child(
                  h_flex().flex_1().min_w(0).h(30).items_center().px(9).rounded(R.control)
                    .border_1().border_color(k.input).bg(k.background)
                    .child(Input.new(this.answer).flex_1().h_full().text_size(T.sm).text_color(k.foreground)),
                )
                .child(
                  Action("muster-card-send", "Send", {
                    style: "primary",
                    icon: "send",
                    onPress: () => this.submitText(cx),
                  }),
                ),
            ),
          )
          .child(
            h_flex().w_full().items_center().gap(6).flex_wrap()
              .when(!closed && card.actions.length > 0, (row) =>
                row.children(
                  card.actions.map((action) => {
                    const key = `${card.id}:${action.id}`;
                    const armed = this.armed === key;
                    const selected = card.answer?.actionId === action.id;
                    return Action(`muster-card-action-${action.id}`, armed ? "Confirm" : action.label, {
                      style: selected ? "primary" : action.style ?? "secondary",
                      icon: selected ? "check" : null,
                      armed,
                      onPress: () => this.answerAction(cx, card, action),
                    });
                  }),
                ),
              )
              .child(div().flex_1())
              .when(!closed, (row) =>
                row
                  .child(
                    Action("muster-card-resolve", "Resolve", {
                      style: card.state === "answered" ? "primary" : "secondary",
                      icon: "check",
                      onPress: () => this.resolve(cx, card),
                    }),
                  )
                  .child(
                    Action("muster-card-dismiss", this.armed === `${card.id}:dismiss` ? "Confirm dismiss" : "Dismiss", {
                      style: "danger",
                      armed: this.armed === `${card.id}:dismiss`,
                      onPress: () => this.dismiss(cx, card),
                    }),
                  ),
              )
              .when(closed, (row) =>
                row.child(
                  h_flex().items_center().gap(6)
                    .child(Icon(stateIcon(card.state) ?? "check", { size: 13, color: stateTone(card.state, k) }))
                    .child(
                      div().text_size(T.sm).text_color(k.muted)
                        .child(card.state === "resolved" ? "Resolved" : card.state === "dismissed" ? "Dismissed" : "Expired"),
                    ),
                ),
              ),
          ),
      );
  }

  label(k, text) {
    return h_flex().w_full().items_center().gap(G.sm)
      .child(div().flex_none().text_size(T.xs).text_color(k.dim).child(text))
      .child(div().flex_1().h(1).bg(k.border));
  }
}
