// @vitest-environment jsdom

import { Project } from "@/core/Project";
import { KeyBindsUI } from "@/core/service/controlService/shortcutKeysEngine/KeyBindsUI";
import { allKeyBinds } from "@/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister";
import { Settings } from "@/core/service/Settings";
import { activeTabAtom, isClassroomModeAtom, store } from "@/state";
import { Color } from "@graphif/data-structures";
import { Provider } from "jotai";
import {
  AlignStartHorizontal,
  Brush,
  Columns3,
  DiamondMinus,
  DiamondPlus,
  Fish,
  GitBranch,
  Hand,
  Package,
  Plus,
  Rows3,
  WandSparkles,
} from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ToolbarContent from "./toolbar-content";

vi.mock("@/core/Project", () => ({ Project: class {} }));
vi.mock("@/core/Tab", () => ({ isResourceTab: () => false }));
vi.mock("@/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister", () => ({ allKeyBinds: [] }));
const keyBindStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock("@/utils/store", () => ({ createStore: async () => keyBindStore }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "actions.alignTop" ? "上对齐" : key) }),
}));
vi.mock("@/core/service/feedbackService/ColorManager", () => ({
  ColorManager: {
    getUserEntityFillColors: async () => [new Color(255, 0, 0, 1)],
    subscribe: () => () => {},
  },
}));
vi.mock("@/core/service/Settings", async () => {
  const { useSyncExternalStore } = await import("react");
  const values: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    Settings: new Proxy(
      { use: (key: string) => [useSyncExternalStore(subscribe, () => values[key])] },
      {
        set: (_, key, value) => {
          values[String(key)] = value;
          listeners.forEach((listener) => listener());
          return true;
        },
        get: (target, key) => (key === "use" ? target.use : values[String(key)]),
      },
    ),
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let selected: number;
let width: number;
let measure: () => void;
let project: Project;
const align = vi.fn();
const create = vi.fn();
const mindMap = vi.fn();
const fishbone = vi.fn();
const arrangeVertical = vi.fn();
const arrangeHorizontal = vi.fn();
const increaseSpacing = vi.fn();
const decreaseSpacing = vi.fn();
const createTwin = vi.fn();
const pack = vi.fn();
const packBinding = {
  id: "packEntityToSection",
  defaultKey: "g",
  icon: Package,
  when: () => selected > 0,
  onPress: pack,
  isToggle: true,
};
const twinBinding = {
  id: "createTwinTextNode",
  defaultKey: "S-y",
  icon: GitBranch,
  when: () => selected > 0,
  onPress: createTwin,
};
const dragBinding = {
  id: "toggleMouseDragMode",
  defaultKey: "",
  icon: Hand,
  isContinuous: true,
  when: () => true,
  onPress: () => {
    Settings.mouseLeftMode = Settings.mouseLeftMode === "drag" ? "selectAndMove" : "drag";
  },
};
const drawingBinding = {
  id: "checkoutLeftMouseToDrawing",
  defaultKey: "p",
  icon: Brush,
  isToggle: true,
  when: () => true,
  onPress: () => {
    Settings.mouseLeftMode = Settings.mouseLeftMode === "draw" ? "selectAndMove" : "draw";
  },
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(update: () => void) {
        measure ??= update;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  selected = 0;
  width = 900;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  Settings.mouseLeftMode = "selectAndMove";
  Settings.viewerMode = false;
  Settings.autoFillPenStrokeColor = [0, 0, 0, 0];
  Settings.autoFillPenStrokeColorEnable = false;
  store.set(isClassroomModeAtom, false);
  store.set(activeTabAtom, undefined);
  project = {
    stageManager: { getSelectionSummary: () => String(selected) },
    rectangleSelect: { getRectangle: () => null },
    canvas: { element: document.createElement("canvas") },
    historyManager: { canUndo: false, canRedo: false },
    controller: { resetCountdownTimer: vi.fn() },
    loop: vi.fn(),
  } as unknown as Project;
  KeyBindsUI.registerOneUIKeyBind(
    "alignTop",
    "8 8",
    true,
    align,
    undefined,
    undefined,
    () => selected >= 2,
    AlignStartHorizontal,
  );
  allKeyBinds.push(drawingBinding, packBinding, twinBinding, dragBinding);
  await KeyBindsUI.registerAllUIKeyBinds();
  KeyBindsUI.registerOneUIKeyBind(
    "mindMapLayout",
    "",
    true,
    mindMap,
    undefined,
    undefined,
    () => selected >= 2,
    WandSparkles,
  );
  KeyBindsUI.registerOneUIKeyBind(
    "fishboneLayout",
    "",
    true,
    fishbone,
    undefined,
    undefined,
    () => selected >= 2,
    Fish,
  );
  KeyBindsUI.registerOneUIKeyBind(
    "arrangeSelectedVertical",
    "",
    true,
    arrangeVertical,
    undefined,
    undefined,
    () => selected >= 2,
    Rows3,
  );
  KeyBindsUI.registerOneUIKeyBind(
    "arrangeSelectedHorizontal",
    "",
    true,
    arrangeHorizontal,
    undefined,
    undefined,
    () => selected >= 2,
    Columns3,
  );
  KeyBindsUI.registerOneUIKeyBind(
    "createTextNodeFromSelectedTop",
    "A-arrowup",
    true,
    create,
    undefined,
    undefined,
    () => false,
    Plus,
    (current) => current === project,
  );
  KeyBindsUI.registerOneUIKeyBind(
    "increaseSelectedNodeSpacing",
    "",
    true,
    increaseSpacing,
    undefined,
    undefined,
    () => selected >= 2,
    DiamondPlus,
  );
  KeyBindsUI.registerOneUIKeyBind(
    "decreaseSelectedNodeSpacing",
    "",
    true,
    decreaseSpacing,
    undefined,
    undefined,
    () => selected >= 2 && decreaseSpacing.mock.calls.length === 0,
    DiamondMinus,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  KeyBindsUI.uiStopListen();
  allKeyBinds.length = 0;
  keyBindStore.get.mockReset();
  await act(async () => root.unmount());
  container.remove();
  measure = undefined!;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

function panel(label: string) {
  return container.querySelector<HTMLDivElement>(`[role="dialog"][aria-label="${label}"]`);
}

async function render() {
  await act(async () =>
    root.render(
      <Provider store={store}>
        <ToolbarContent project={project} />
      </Provider>,
    ),
  );
}

it("reflects mode changes, applies a saved pen color and preserves selection when switching back", async () => {
  selected = 2;
  await render();
  expect(button("selectAndMove").getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    Settings.mouseLeftMode = "draw";
  });
  expect(button("draw").getAttribute("aria-pressed")).toBe("true");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="penColors"] button:last-child')!.click(),
  );
  expect(Settings.autoFillPenStrokeColor).toEqual([255, 0, 0, 1]);
  expect(Settings.autoFillPenStrokeColorEnable).toBe(true);
  await act(async () => button("selectAndMove").click());
  expect(Settings.mouseLeftMode).toBe("selectAndMove");
  expect(selected).toBe(2);
  expect(container.querySelector('[aria-label="penColors"]')).toBeNull();
  await act(async () => store.set(isClassroomModeAtom, true));
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
});

it("toggles the hand tool by click or a customized shortcut", async () => {
  await render();
  const hand = button("drag");
  expect(hand.querySelector(".lucide-hand")).not.toBeNull();
  expect(hand.querySelector("kbd")).toBeNull();
  await act(async () => hand.click());
  expect(hand.getAttribute("aria-pressed")).toBe("true");
  await act(async () => hand.click());
  expect(button("selectAndMove").getAttribute("aria-pressed")).toBe("true");

  store.set(activeTabAtom, Object.assign(Object.create(Project.prototype), project));
  KeyBindsUI.uiStartListen();
  const key = (type: "keydown" | "keyup", key: string, repeat = false) =>
    act(async () => window.dispatchEvent(new KeyboardEvent(type, { key, repeat })));
  await act(async () => KeyBindsUI.changeOneUIKeyBind("toggleMouseDragMode", "j"));
  expect(keyBindStore.set).toHaveBeenCalledWith("toggleMouseDragMode", { key: "j", isEnabled: true });
  expect(hand.querySelector("kbd")?.textContent).toBe("j");
  await key("keydown", "h");
  expect(hand.getAttribute("aria-pressed")).toBe("false");
  await key("keydown", "j");
  expect(hand.getAttribute("aria-pressed")).toBe("true");
  await key("keydown", "j", true);
  expect(hand.getAttribute("aria-pressed")).toBe("true");
  await key("keyup", "j");
  await key("keydown", "j");
  expect(hand.getAttribute("aria-pressed")).toBe("false");
});

it("shows P on the pen, replaces the old default and keeps custom pen bindings", async () => {
  keyBindStore.get.mockResolvedValue({ key: "b b b", isEnabled: true });
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(keyBindStore.set).toHaveBeenCalledWith(drawingBinding.id, { key: "p", isEnabled: true });
  await render();
  const pen = button("draw");
  expect(pen.querySelector("kbd")?.textContent).toBe("p");
  expect(button("connectAndCut")).toBeNull();

  await act(async () => pen.click());
  expect(pen.getAttribute("aria-pressed")).toBe("true");
  await act(async () => pen.click());
  expect(Settings.mouseLeftMode).toBe("selectAndMove");

  keyBindStore.get.mockResolvedValue({ key: "g p", isEnabled: true });
  await act(async () => KeyBindsUI.registerAllUIKeyBinds());
  expect(pen.querySelector("kbd")?.textContent).toBe("g, p");
});

it("toggles drawing once per P press and preserves longer shortcuts beginning with P", async () => {
  await KeyBindsUI.changeOneUIKeyBind(dragBinding.id, "j");
  await render();
  const sequence = vi.fn();
  await act(async () => KeyBindsUI.registerOneUIKeyBind("testPenSequence", "p s c 0", true, sequence));
  store.set(activeTabAtom, Object.assign(Object.create(Project.prototype), project));
  KeyBindsUI.uiStartListen();
  const press = (key: string, repeat = false) =>
    act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key, repeat })));
  try {
    await press("p");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(Settings.mouseLeftMode).toBe("draw");
    await press("p", true);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(Settings.mouseLeftMode).toBe("draw");
    await press("p");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(Settings.mouseLeftMode).toBe("selectAndMove");
    for (const key of ["p", "s", "c", "0"]) await press(key);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(sequence).toHaveBeenCalledOnce();
    expect(Settings.mouseLeftMode).toBe("selectAndMove");
    await press("p");
    await press("j");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(Settings.mouseLeftMode).toBe("drag");
  } finally {
    await act(async () => KeyBindsUI.unregisterOneUIKeyBind("testPenSequence"));
  }
});

it("puts Group after the brush and restores Twin Node to Organize with Shift+Y", async () => {
  const saved = {
    [packBinding.id]: { key: "h", isEnabled: true },
    [twinBinding.id]: { key: "S-y", isEnabled: true },
    [dragBinding.id]: { key: "", isEnabled: true },
    toolbarPackShortcutMigrated: true,
  };
  keyBindStore.get.mockImplementation(async (id: keyof typeof saved) => saved[id]);
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(keyBindStore.set).toHaveBeenCalledWith(packBinding.id, { key: "g", isEnabled: true });
  await render();

  const packButton = button("keyBinds:packEntityToSection.title");
  const toolbar = container.querySelector('[role="toolbar"]')!;
  expect([...toolbar.querySelectorAll("button")].slice(2, 4)).toEqual([button("draw"), packButton]);
  expect(packButton.querySelector("kbd")?.textContent).toBe("g");
  expect(packButton.disabled).toBe(true);
  await act(async () => button("organize").click());
  expect(panel("organize")!.contains(button("keyBinds:createTwinTextNode.title"))).toBe(true);
  expect(panel("organize")!.querySelector('button[aria-label="keyBinds:packEntityToSection.title"]')).toBeNull();
  await act(async () => {
    selected = 1;
    vi.advanceTimersByTime(100);
  });
  expect(packButton.disabled).toBe(false);
  await act(async () => packButton.click());
  expect(pack).toHaveBeenCalledExactlyOnceWith(project, "toolbar");

  const active = Object.assign(Object.create(Project.prototype), project);
  store.set(activeTabAtom, active);
  KeyBindsUI.uiStartListen();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" })));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", repeat: true })));
  expect(pack).toHaveBeenLastCalledWith(active);
  expect(pack).toHaveBeenCalledTimes(2);
  expect(Settings.mouseLeftMode).toBe("selectAndMove");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Y", shiftKey: true })));
  expect(createTwin).toHaveBeenCalledExactlyOnceWith(active);
});

it("preserves key sequences that start with or pass through G", async () => {
  selected = 1;
  const generate = vi.fn();
  const tag = vi.fn();
  KeyBindsUI.registerOneUIKeyBind("testGenerate", "g e n", true, generate);
  KeyBindsUI.registerOneUIKeyBind("testTag", "t a g g", true, tag);
  store.set(activeTabAtom, Object.assign(Object.create(Project.prototype), project));
  KeyBindsUI.uiStartListen();
  const press = (key: string) => act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
  try {
    for (const key of ["g", "e", "n", "t", "a", "g", "g"]) await press(key);
    await vi.advanceTimersByTimeAsync(250);
    expect(generate).toHaveBeenCalledOnce();
    expect(tag).toHaveBeenCalledOnce();
    expect(pack).not.toHaveBeenCalled();

    await press("g");
    await vi.advanceTimersByTimeAsync(250);
    expect(pack).toHaveBeenCalledOnce();
  } finally {
    KeyBindsUI.unregisterOneUIKeyBind("testGenerate");
    KeyBindsUI.unregisterOneUIKeyBind("testTag");
  }
});

it("keeps a hover panel open while crossing to it and closes it after leaving", async () => {
  await render();
  const trigger = button("layout");
  await act(async () =>
    trigger.dispatchEvent(new PointerEvent("pointerover", { pointerType: "mouse", bubbles: true })),
  );
  const popup = panel("layout")!;
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerout", { pointerType: "mouse", bubbles: true }));
    vi.advanceTimersByTime(100);
    popup.dispatchEvent(new PointerEvent("pointerover", { pointerType: "mouse", bubbles: true }));
    vi.advanceTimersByTime(100);
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    popup.dispatchEvent(new PointerEvent("pointerout", { pointerType: "mouse", bubbles: true }));
    vi.advanceTimersByTime(200);
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("shows an icon label below its trigger only after a sustained hover", async () => {
  await render();
  const trigger = button("layout");
  const tooltip = () => container.querySelector('[data-slot="tooltip-content"]');
  const moveOverIcon = () => {
    trigger.dispatchEvent(new PointerEvent("pointerover", { pointerType: "mouse", bubbles: true }));
    trigger.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", bubbles: true }));
  };
  const leaveIcon = () =>
    trigger.dispatchEvent(new PointerEvent("pointerout", { pointerType: "mouse", bubbles: true }));

  await act(async () => {
    moveOverIcon();
    vi.advanceTimersByTime(799);
  });
  expect(panel("layout")).not.toBeNull();
  expect(tooltip()).toBeNull();
  await act(async () => {
    leaveIcon();
    vi.advanceTimersByTime(800);
  });
  expect(tooltip()).toBeNull();

  await act(async () => {
    moveOverIcon();
    vi.advanceTimersByTime(800);
  });
  expect(tooltip()?.getAttribute("data-side")).toBe("bottom");
  expect(tooltip()?.hasAttribute("data-follow-cursor")).toBe(false);
  expect(tooltip()?.textContent).toContain("layout");
  await act(async () => leaveIcon());
  expect(tooltip()).toBeNull();
});

it("updates a pinned panel from single to multiple selection and validates again before running", async () => {
  await render();
  await act(async () => button("align").click());
  const alignTop = button("keyBinds:alignTop.title");
  expect(alignTop.disabled).toBe(true);
  await act(async () => alignTop.click());
  expect(align).not.toHaveBeenCalled();
  await act(async () => {
    selected = 1;
    vi.advanceTimersByTime(100);
  });
  expect(alignTop.disabled).toBe(true);
  await act(async () => {
    selected = 2;
    vi.advanceTimersByTime(100);
  });
  expect(alignTop.disabled).toBe(false);
  await act(async () => {
    selected = 0;
    alignTop.click();
  });
  expect(align).not.toHaveBeenCalled();
  selected = 2;
  await act(async () => button("align").click());
  await act(async () => button("keyBinds:alignTop.title").click());
  expect(align).toHaveBeenCalledWith(project, "toolbar");
  expect(button("align").getAttribute("aria-expanded")).toBe("false");
});

it("keeps a disabled action's tooltip to one line with its name and shortcut", async () => {
  await render();
  await act(async () => button("align").click());
  const alignTop = button("keyBinds:alignTop.title");
  expect(alignTop.disabled).toBe(true);
  await act(async () => {
    alignTop.parentElement!.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", bubbles: true }));
    vi.advanceTimersByTime(800);
  });

  const tooltip = container.querySelector('[data-slot="tooltip-content"]');
  expect(tooltip?.classList.contains("whitespace-nowrap")).toBe(true);
  expect(tooltip?.firstChild?.textContent).toBe("上对齐");
  expect(tooltip?.querySelector("kbd")?.textContent).toBe("8, 8");
  expect(tooltip?.textContent).not.toContain("disabled.");
});

it("shows alignment and arrangement actions in one row with a vertical separator", async () => {
  allKeyBinds.push({
    id: "alignTop",
    defaultKey: "8 8",
    icon: AlignStartHorizontal,
    when: () => selected >= 2,
    onPress: align,
  });
  KeyBindsUI.unregisterOneUIKeyBind("alignTop");
  await render();
  const trigger = button("align");
  expect(trigger.querySelector(".lucide-align-horizontal-justify-center")).not.toBeNull();
  await act(async () => trigger.click());
  expect(button("keyBinds:alignTop.title").querySelector("svg.lucide-align-start-horizontal")).not.toBeNull();
  const separator = panel("align")!.querySelector('[data-slot="separator"][data-orientation="vertical"]')!;
  expect(separator.previousElementSibling?.contains(button("keyBinds:alignCenterVertical.title"))).toBe(true);
  expect(separator.nextElementSibling?.contains(button("keyBinds:arrangeSelectedVertical.title"))).toBe(true);
  expect(
    [...separator.parentElement!.querySelectorAll("button")].map((action) => action.getAttribute("aria-label")),
  ).toEqual(
    [
      "alignTop",
      "alignBottom",
      "alignLeft",
      "alignRight",
      "alignCenterHorizontal",
      "alignCenterVertical",
      "arrangeSelectedVertical",
      "arrangeSelectedHorizontal",
    ].map((id) => `keyBinds:${id}.title`),
  );
  await act(async () => button("layout").click());
  expect(panel("align")).toBeNull();
  expect(button("keyBinds:alignTop.title")).toBeNull();
  expect(button("keyBinds:layoutToSquare.title")).not.toBeNull();
});

it("shows the creation modifier and only the four directional actions", async () => {
  await render();
  const trigger = button("create");
  expect(trigger.querySelector("kbd")?.textContent).toBe("Alt");
  await act(async () => trigger.click());
  expect([...panel("create")!.querySelectorAll("button")].map((action) => action.getAttribute("aria-label"))).toEqual(
    ["Top", "Right", "Left", "Down"].map((direction) => `keyBinds:createTextNodeFromSelected${direction}.title`),
  );
});

it("shows the waypoints and opposing arrows in the connection menu", async () => {
  await render();
  const trigger = button("connect");
  expect(trigger.querySelector("svg.lucide-waypoints")).not.toBeNull();
  await act(async () => trigger.click());
  expect(
    button("keyBinds:connectAllSelectedEntities.title").querySelector("svg.lucide-arrow-right-left"),
  ).not.toBeNull();
});

it("shows the mind map and fishbone actions for multiple selected nodes", async () => {
  await render();
  await act(async () => button("layout").click());
  const map = button("keyBinds:mindMapLayout.title");
  const fish = button("keyBinds:fishboneLayout.title");
  const actions = [map, fish];
  expect([...panel("layout")!.querySelectorAll("button")]).toEqual([
    button("keyBinds:layoutToSquare.title"),
    ...actions,
    button("keyBinds:increaseSelectedNodeSpacing.title"),
    button("keyBinds:decreaseSelectedNodeSpacing.title"),
  ]);
  expect(map.querySelector("svg.lucide-diagram-flow-horizontal")).not.toBeNull();
  expect(fish.querySelector("svg.lucide-fish-symbol")).not.toBeNull();
  expect(actions.every((action) => action.disabled)).toBe(true);
  await act(async () => {
    selected = 1;
    vi.advanceTimersByTime(100);
  });
  expect(actions.every((action) => action.disabled)).toBe(true);
  await act(async () => {
    for (const action of actions) action.click();
  });
  expect(mindMap).not.toHaveBeenCalled();
  expect(fishbone).not.toHaveBeenCalled();

  await act(async () => {
    selected = 2;
    vi.advanceTimersByTime(100);
  });
  expect(actions.every((action) => !action.disabled)).toBe(true);
  await act(async () => map.click());
  expect(mindMap).toHaveBeenCalledExactlyOnceWith(project, "toolbar");
  await act(async () => button("layout").click());
  await act(async () => button("keyBinds:fishboneLayout.title").click());
  expect(fishbone).toHaveBeenCalledExactlyOnceWith(project, "toolbar");
});

it("keeps layout open for repeated spacing adjustments and refreshes the minimum-gap state", async () => {
  await render();
  await act(async () => button("layout").click());
  const increase = button("keyBinds:increaseSelectedNodeSpacing.title");
  const decrease = button("keyBinds:decreaseSelectedNodeSpacing.title");
  expect(increase.querySelector("svg.lucide-diamond-plus")).not.toBeNull();
  expect(decrease.querySelector("svg.lucide-diamond-minus")).not.toBeNull();
  expect(increase.disabled).toBe(true);
  expect(decrease.disabled).toBe(true);
  await act(async () => {
    selected = 2;
    vi.advanceTimersByTime(100);
  });
  await act(async () => increase.click());
  await act(async () => increase.click());
  await act(async () => decrease.click());
  expect(increaseSpacing).toHaveBeenCalledTimes(2);
  expect(decreaseSpacing).toHaveBeenCalledExactlyOnceWith(project, "toolbar");
  expect(panel("layout")).not.toBeNull();
  expect(decrease.disabled).toBe(true);
});

it("hides the previous spacing row and enables both arrangements only for multiple selected nodes", async () => {
  await render();
  await act(async () => button("align").click());
  for (const id of [
    "alignHorizontalSpaceBetween",
    "alignVerticalSpaceBetween",
    "alignLeftToRightNoSpace",
    "alignTopToBottomNoSpace",
  ]) {
    expect(button(`keyBinds:${id}.title`)).toBeNull();
  }
  const vertical = button("keyBinds:arrangeSelectedVertical.title");
  const horizontal = button("keyBinds:arrangeSelectedHorizontal.title");
  expect(vertical.querySelector("svg.lucide-layout-arrow-down")).not.toBeNull();
  expect(horizontal.querySelector("svg.lucide-layout-arrow-right")).not.toBeNull();
  expect(vertical.disabled).toBe(true);
  expect(horizontal.disabled).toBe(true);
  await act(async () => {
    selected = 2;
    vi.advanceTimersByTime(100);
  });
  expect(vertical.disabled).toBe(false);
  expect(horizontal.disabled).toBe(false);
  await act(async () => vertical.click());
  expect(arrangeVertical).toHaveBeenCalledExactlyOnceWith(project, "toolbar");
  await act(async () => button("align").click());
  await act(async () => button("keyBinds:arrangeSelectedHorizontal.title").click());
  expect(arrangeHorizontal).toHaveBeenCalledExactlyOnceWith(project, "toolbar");
});

it("uses the rendered project and toolbar condition, and puts collapsed categories in More", async () => {
  await render();
  expect(button("tree")).toBeNull();
  await act(async () => {
    width = 210;
    measure();
    vi.advanceTimersByTime(20);
  });
  expect(button("create")).toBeNull();
  expect(button("align")).toBeNull();
  expect(button("draw")).not.toBeNull();
  await act(async () => button("more").click());
  expect(button("keyBinds:alignTop.title")).not.toBeNull();
  for (const id of [
    "generateNodeTreeWithDeepMode",
    "generateNodeTreeWithBroadMode",
    "generateNodeTreeWithDeepModeEditEdge",
  ]) {
    expect(button(`keyBinds:${id}.title`)).toBeNull();
  }
  const createAbove = button("keyBinds:createTextNodeFromSelectedTop.title");
  expect(createAbove.disabled).toBe(false);
  expect(document.activeElement).toBe(createAbove);
  expect(await KeyBindsUI.execute("createTextNodeFromSelectedTop", project)).toBe(false);
  await act(async () => createAbove.click());
  expect(create).toHaveBeenCalledWith(project, "toolbar");
  expect(button("more").getAttribute("aria-expanded")).toBe("false");
});
