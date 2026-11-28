// @vitest-environment jsdom

import { Project, ProjectState } from "@/core/Project";
import { createTabGroup, splitTabGroup } from "@/core/TabGroup";
import { store, tabGroupRootAtom, tabsAtom } from "@/state";
import { createInstance } from "i18next";
import { Provider } from "jotai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";

vi.mock("@/core/Project", () => ({ Project: class {}, ProjectState: { Saved: "saved" } }));
vi.mock("@/core/Tab", () => ({ isResourceTab: () => false }));
vi.mock("@/core/TabWorkspace", () => ({ TabWorkspace: {} }));
vi.mock("@/utils/platform", () => ({ isMac: false }));
vi.mock("@/ProjectTabs", () => ({
  ProjectTabs: () => (
    <div data-pg-tab-bar>
      <button data-pg-docked-tab-id="test-tab">Tab</button>
    </div>
  ),
}));

import DockedArea from "./docked-area";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let space: DOMRect;
let groupRects: Record<string, DOMRect>;
let updateLayout: () => void;
const disconnect = vi.fn();
const onTitleBarMouseDown = vi.fn();
const i18n = createInstance();

beforeAll(async () => {
  const zh_CN = parse(readFileSync(resolve(import.meta.dirname, "../locales/zh_CN.yml"), "utf8"));
  await i18n.init({ lng: "zh_CN", resources: { zh_CN } });
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  space = new DOMRect(120, 8, 760, 40);
  groupRects = { main: new DOMRect(0, 0, 1000, 56) };
  store.set(tabsAtom, []);
  store.set(tabGroupRootAtom, createTabGroup([], "main"));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        updateLayout = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-pg-titlebar-tab-space")) return space;
    return groupRects[this.closest<HTMLElement>("[data-pg-tab-group-id]")?.dataset.pgTabGroupId ?? "main"];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function render() {
  await React.act(async () =>
    root.render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <DockedArea
            onTabClick={vi.fn()}
            onTabClose={vi.fn()}
            onTitleBarMouseDown={onTitleBarMouseDown}
            isClassroomMode={false}
          />
        </I18nextProvider>
        <div data-pg-titlebar-tab-space />
      </Provider>,
    ),
  );
}

it("reserves the menu and controls' actual bounds and updates when the titlebar resizes", async () => {
  await render();
  const bar = container.querySelector<HTMLElement>("[data-pg-window-top-tabs]")!;
  expect([bar.style.paddingLeft, bar.style.paddingRight]).toEqual(["120px", "120px"]);

  space = new DOMRect(150, 12, 670, 60);
  updateLayout();
  expect([bar.style.paddingLeft, bar.style.paddingRight]).toEqual(["150px", "180px"]);
  await React.act(async () => root.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
});

it("only insets top groups and gives narrow splits their own row to keep tabs accessible", async () => {
  const horizontal = splitTabGroup(createTabGroup([], "main"), "main", createTabGroup([], "right"), "right");
  store.set(tabGroupRootAtom, splitTabGroup(horizontal, "right", createTabGroup([], "bottom"), "bottom"));
  groupRects = {
    main: new DOMRect(0, 0, 500, 56),
    right: new DOMRect(500, 0, 500, 56),
    bottom: new DOMRect(500, 400, 500, 32),
  };
  await render();
  const bars = container.querySelectorAll<HTMLElement>("[data-pg-window-top-tabs]");
  expect(bars).toHaveLength(2);
  expect([bars[0].style.paddingLeft, bars[0].style.paddingRight]).toEqual(["120px", "0px"]);
  expect([bars[1].style.paddingLeft, bars[1].style.paddingRight]).toEqual(["0px", "120px"]);

  space = new DOMRect(600, 8, 100, 40);
  updateLayout();
  expect(bars[0].hasAttribute("data-pg-tabs-separate-row")).toBe(true);
  expect([bars[0].style.paddingLeft, bars[0].style.paddingRight]).toEqual(["", ""]);
  expect([bars[1].style.paddingLeft, bars[1].style.paddingRight]).toEqual(["100px", "300px"]);

  space = new DOMRect(120, 8, 760, 40);
  updateLayout();
  expect(bars[0].hasAttribute("data-pg-tabs-separate-row")).toBe(false);
  expect(bars[0].style.paddingLeft).toBe("120px");
});

it("drags the window from titlebar space while leaving tab mouse events alone", async () => {
  await render();
  const bar = container.querySelector<HTMLElement>("[data-pg-window-top-tabs]")!;
  await React.act(async () =>
    bar.querySelector("button")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
  );
  expect(onTitleBarMouseDown).not.toHaveBeenCalled();
  await React.act(async () => bar.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(onTitleBarMouseDown).toHaveBeenCalledOnce();
});

it("shows zoom on an empty canvas and resets it immediately when clicked", async () => {
  const camera = {
    currentScale: 0.45,
    resetScale: vi.fn(() => {
      camera.currentScale = 1;
    }),
    toggleFitView: vi.fn(),
  };
  const resetCountdownTimer = vi.fn();
  const loop = vi.fn();
  const project = Object.assign(Object.create(Project.prototype), {
    id: "project",
    layout: "docked",
    projectState: ProjectState.Saved,
    getComponent: () => () => null,
    renderer: { getCoverWorldRectangle: vi.fn() },
    stageManager: { getEntities: () => [], getAssociations: () => [], getSelectedStageObjects: () => [] },
    controller: { resetCountdownTimer },
    camera,
    loop,
  });
  store.set(tabsAtom, [project]);
  store.set(tabGroupRootAtom, createTabGroup([project.id], "main"));
  await render();

  const zoom = container.querySelector<HTMLButtonElement>(
    `button[title="${i18n.t("keyBinds:resetCameraScale.title")}"]`,
  )!;
  expect(container.textContent).toContain(i18n.t("projectStatus:emptyCanvas"));
  expect(zoom.textContent).toBe("45%");
  await React.act(async () => zoom.click());

  expect(zoom.textContent).toBe("100%");
  expect(camera.resetScale).toHaveBeenCalledOnce();
  expect(camera.toggleFitView).not.toHaveBeenCalled();
  expect(resetCountdownTimer).toHaveBeenCalledOnce();
  expect(loop).toHaveBeenCalledOnce();
});

it("keeps fixed-width number slots as the status values gain digits", async () => {
  vi.useFakeTimers();
  let count = 9;
  const entity = { collisionBox: { getRectangle: () => ({ width: 100, height: 100 }) } };
  const camera = { currentScale: 0.99 };
  const project = Object.assign(Object.create(Project.prototype), {
    id: "project",
    layout: "docked",
    projectState: ProjectState.Saved,
    getComponent: () => () => null,
    renderer: { getCoverWorldRectangle: () => ({ isCollideWith: () => true }) },
    stageManager: {
      getEntities: () => Array(count).fill(entity),
      getAssociations: () => Array(count + 1),
      getSelectedStageObjects: () => Array(count - 1),
    },
    camera,
  });
  store.set(tabsAtom, [project]);
  store.set(tabGroupRootAtom, createTabGroup([project.id], "main"));
  await render();

  const numbers = () => [...container.querySelectorAll('[class~="w-[6ch]"]')].map((slot) => slot.textContent);
  const zoom = container.querySelector('[class~="w-[5ch]"]')!;
  expect(numbers()).toEqual(["9", "10", "8"]);
  expect(zoom.textContent).toBe("99");

  count = 100;
  camera.currentScale = 1;
  await React.act(async () => vi.advanceTimersByTime(250));
  expect(numbers()).toEqual(["100", "101", "99"]);
  expect(zoom.textContent).toBe("100");
});
