// Muster in the Herdr app: one mod, one view per place it shows
// (`props.app`), so every block shares the snapshot client and the kit. A view
// is a class with init(cx), render(cx), and optionally close(cx). The brand
// copy drains the command queue and handles the layout's global keys.

import { View } from "gpui-kit";
import { nextCommand } from "herdr";
import { nextCard, openCard, refresh, select, selectedProject, setProject } from "./state.js";
import Brand from "./brand.js";
import Sidebar from "./sidebar.js";
import Footer from "./footer.js";
import Bell from "./bell.js";
import Board from "./board.js";
import Cards from "./cards.js";
import Runbook from "./runbook.js";
import Stats from "./stats.js";
import Status from "./status.js";
import Pane from "./pane.js";

const VIEWS = {
  brand: Brand,
  sidebar: Sidebar,
  footer: Footer,
  bell: Bell,
  board: Board,
  cards: Cards,
  runbook: Runbook,
  stats: Stats,
  status: Status,
  pane: Pane,
};

const CENTER = new Set(["board", "cards", "runbook", "stats", "work"]);

export default class Muster extends View {
  init(p, cx) {
    const app = p?.app ?? "board";
    this.app = app;
    const Impl = VIEWS[app] ?? Board;
    this.view = new Impl();
    this.view.init?.(p, cx);

    cx.spawn(async (cx) => {
      for (;;) {
        let command;
        try {
          command = await nextCommand();
        } catch {
          break;
        }
        if (app === "brand") await this.hotkey(command, cx);
        else this.view.command?.(command, cx);
        cx.notify();
      }
    });
  }

  /** Layout keys: go to a view, the next thing that needs a person, refresh. */
  async hotkey(command, cx) {
    if (command.startsWith("muster.go:")) {
      const child = command.slice(10);
      if (CENTER.has(child)) select(child);
      return;
    }
    if (command === "muster.next") {
      const card = nextCard();
      if (card) openCard(card);
      else {
        const key = selectedProject();
        if (key) setProject(key);
        select("board");
      }
      return;
    }
    if (command === "muster.refresh") {
      await refresh(true).catch(() => {});
      cx.notify();
    }
  }

  render(cx) {
    return this.view.render(cx);
  }

  close(cx) {
    this.view.close?.(cx);
  }

  command(command, cx) {
    this.view.command?.(command, cx);
  }
}
