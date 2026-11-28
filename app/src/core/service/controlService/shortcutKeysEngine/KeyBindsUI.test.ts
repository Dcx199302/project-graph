// @vitest-environment jsdom

import { Project } from "@/core/Project";
import { Redo } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { KeyBindsUI } from "./KeyBindsUI";
import { allKeyBinds } from "./shortcutKeysRegister";

const config = vi.hoisted(() => ({
  isMac: true,
  project: undefined as unknown,
  store: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
}));

vi.mock("@/core/Project", () => ({ Project: class {} }));
vi.mock("@/state", () => ({ activeResourceTabAtom: {}, activeTabAtom: {}, store: { get: () => config.project } }));
vi.mock("@/utils/platform", () => ({
  get isMac() {
    return config.isMac;
  },
}));
vi.mock("@/utils/store", () => ({ createStore: async () => config.store }));
vi.mock("./shortcutKeysRegister", () => ({ allKeyBinds: [] }));

afterEach(() => {
  for (const { id } of allKeyBinds) KeyBindsUI.unregisterOneUIKeyBind(id);
  allKeyBinds.length = 0;
  KeyBindsUI.uiStopListen();
  config.project = undefined;
  document.body.replaceChildren();
  vi.resetAllMocks();
});

it.each([
  { isMac: true, saved: undefined, expected: "S-M-z", enabled: true, savesKey: true },
  { isMac: true, saved: "M-y", expected: "S-M-z", enabled: true, savesKey: true },
  { isMac: true, saved: { key: "M-y", isEnabled: false }, expected: "S-M-z", enabled: false, savesKey: true },
  { isMac: true, saved: { key: "M-r" }, expected: "M-r", enabled: true },
  { isMac: true, saved: { key: "M-y" }, expected: "M-y", enabled: true, migrated: true },
  { isMac: false, saved: undefined, expected: "C-y", enabled: true, savesKey: true },
  { isMac: false, saved: { key: "C-y" }, expected: "C-y", enabled: true },
])(
  "loads redo as $expected with enabled=$enabled from $saved",
  async ({ isMac, saved, expected, enabled, savesKey, migrated }) => {
    config.isMac = isMac;
    config.store.get.mockImplementation(async (key) => (key === "redo" ? saved : migrated));
    const onPress = vi.fn();
    allKeyBinds.push({ id: "redo", defaultKey: isMac ? "S-C-z" : "C-y", onPress, when: () => true, icon: Redo });
    await KeyBindsUI.registerAllUIKeyBinds();
    expect(KeyBindsUI.getUIKeyBind("redo")).toMatchObject({ key: expected, isEnabled: enabled });
    expect(config.store.set.mock.calls.filter(([id]) => id === "macRedoShortcutMigrated")).toEqual(
      isMac && !migrated ? [["macRedoShortcutMigrated", true]] : [],
    );
    if (savesKey) {
      expect(config.store.set).toHaveBeenCalledWith("redo", { key: expected, isEnabled: enabled });
    } else {
      expect(config.store.set).not.toHaveBeenCalledWith("redo", expect.anything());
    }

    KeyBindsUI.uiStartListen();
    const event = new KeyboardEvent("keydown", {
      key: expected.at(-1),
      metaKey: isMac,
      shiftKey: expected.startsWith("S-"),
      ctrlKey: !isMac,
      cancelable: true,
    });
    window.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(event.defaultPrevented).toBe(enabled);
    expect(onPress).toHaveBeenCalledTimes(enabled ? 1 : 0);
  },
);

it.each([true, false])("swaps saved default directional shortcuts on macOS=%s", async (isMac) => {
  config.isMac = isMac;
  const create = "createTextNodeFromSelectedTop";
  const move = "moveUpSelectedEntities";
  const custom = "moveLeftSelectedEntities";
  const command = isMac ? "M" : "C";
  const saved = new Map<string, unknown>([
    [create, { key: "A-arrowup", isEnabled: false }],
    [move, `${command}-arrowup`],
    [custom, { key: "u" }],
  ]);
  config.store.get.mockImplementation(async (key: string) => saved.get(key));
  config.store.set.mockImplementation(async (key: string, value: unknown) => void saved.set(key, value));
  const action = { onPress: vi.fn(), when: () => true, icon: Redo };
  allKeyBinds.push(
    { ...action, id: create, defaultKey: "C-arrowup" },
    { ...action, id: move, defaultKey: "A-arrowup" },
    { ...action, id: custom, defaultKey: "A-arrowleft" },
  );

  await KeyBindsUI.registerAllUIKeyBinds();
  expect(KeyBindsUI.getUIKeyBind(create)).toMatchObject({ key: `${command}-arrowup`, isEnabled: false });
  expect(KeyBindsUI.getUIKeyBind(move)).toMatchObject({ key: "A-arrowup", isEnabled: true });
  expect(KeyBindsUI.getUIKeyBind(custom)?.key).toBe("u");
  expect(saved.get("directionalShortcutsMigrated")).toBe(true);

  saved.set(create, { key: "A-arrowup" });
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(KeyBindsUI.getUIKeyBind(create)?.key).toBe("A-arrowup");
});

it.each([true, false])("migrates the old reverse-edge key once on macOS=%s", async (isMac) => {
  config.isMac = isMac;
  const id = "reverseEdges";
  const previousKey = isMac ? "M-t" : "C-t";
  const saved = new Map<string, unknown>([[id, { key: previousKey, isEnabled: false }]]);
  config.store.get.mockImplementation(async (key: string) => saved.get(key));
  config.store.set.mockImplementation(async (key: string, value: unknown) => void saved.set(key, value));
  allKeyBinds.push({ id, defaultKey: "t", onPress: vi.fn(), when: () => true, icon: Redo });

  await KeyBindsUI.registerAllUIKeyBinds();
  expect(KeyBindsUI.getUIKeyBind(id)).toMatchObject({ key: "t", isEnabled: false });
  expect(saved.get(id)).toEqual({ key: "t", isEnabled: false });

  await KeyBindsUI.changeOneUIKeyBind(id, previousKey);
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(KeyBindsUI.getUIKeyBind(id)).toMatchObject({ key: previousKey, isEnabled: false });
});

it("moves Shift+F from the saved camera default to tidy tree layout once", async () => {
  const saved = new Map<string, unknown>([
    ["restoreCameraState", { key: "S-F", isEnabled: true }],
    ["tidyTreeLayout", { key: "", isEnabled: true }],
  ]);
  config.store.get.mockImplementation(async (key: string) => saved.get(key));
  config.store.set.mockImplementation(async (key: string, value: unknown) => void saved.set(key, value));
  const restore = vi.fn();
  const layout = vi.fn();
  const binding = { when: () => true, icon: Redo };
  allKeyBinds.push(
    { ...binding, id: "restoreCameraState", defaultKey: "", onPress: restore },
    { ...binding, id: "tidyTreeLayout", defaultKey: "S-f", onPress: layout, isRepeatable: false },
  );

  await KeyBindsUI.registerAllUIKeyBinds();
  expect(saved.get("restoreCameraState")).toEqual({ key: "", isEnabled: true });
  expect(saved.get("tidyTreeLayout")).toEqual({ key: "S-f", isEnabled: true });
  KeyBindsUI.uiStartListen();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F", shiftKey: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(layout).toHaveBeenCalledOnce();
  expect(restore).not.toHaveBeenCalled();

  await KeyBindsUI.changeOneUIKeyBind("tidyTreeLayout", "");
  await KeyBindsUI.changeOneUIKeyBind("restoreCameraState", "S-f");
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(KeyBindsUI.getUIKeyBind("tidyTreeLayout")?.key).toBe("");
  expect(KeyBindsUI.getUIKeyBind("restoreCameraState")?.key).toBe("S-f");
});

it("migrates saved font shortcuts and keeps command presses and longer sequences distinct", async () => {
  vi.useFakeTimers();
  try {
    config.isMac = true;
    config.project = Object.create(Project.prototype);
    const saved = new Map<string, unknown>([
      ["increaseFontSize", { key: "M-=", isEnabled: true }],
      ["decreaseFontSize", { key: "M--", isEnabled: true }],
    ]);
    config.store.get.mockImplementation(async (key: string) => saved.get(key));
    config.store.set.mockImplementation(async (key: string, value: unknown) => void saved.set(key, value));
    const increase = vi.fn();
    const decrease = vi.fn();
    const increaseBoth = vi.fn();
    const decreaseBoth = vi.fn();
    const filter = vi.fn();
    const edge = vi.fn();
    const binding = { when: () => true, icon: Redo };
    allKeyBinds.push(
      { ...binding, id: "increaseFontSize", defaultKey: "=", isToggle: true, onPress: increase },
      { ...binding, id: "decreaseFontSize", defaultKey: "-", isToggle: true, onPress: decrease },
      { ...binding, id: "increaseFontSizeAndSpacing", defaultKey: "C-=", onPress: increaseBoth },
      { ...binding, id: "decreaseFontSizeAndSpacing", defaultKey: "C--", onPress: decreaseBoth },
      { ...binding, id: "hideEdges", defaultKey: "- - a l l", onPress: filter },
      { ...binding, id: "showEdges", defaultKey: "+ e d g e", onPress: edge },
    );
    await KeyBindsUI.registerAllUIKeyBinds();
    expect(saved.get("increaseFontSize")).toEqual({ key: "=", isEnabled: true });
    expect(saved.get("decreaseFontSize")).toEqual({ key: "-", isEnabled: true });
    KeyBindsUI.uiStartListen();
    const press = async (key: string, modifiers?: KeyboardEventInit) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, ...modifiers }));
      await vi.advanceTimersByTimeAsync(0);
    };

    await press("+", { code: "Equal", shiftKey: true });
    await press("-");
    await vi.advanceTimersByTimeAsync(250);
    await press("+", { code: "Equal", shiftKey: true, metaKey: true });
    await press("-", { metaKey: true });
    for (const key of ["-", "-", "a", "l", "l"]) await press(key);
    for (const key of ["+", "e", "d", "g", "e"]) await press(key);
    await vi.advanceTimersByTimeAsync(250);

    for (const action of [increase, decrease, increaseBoth, decreaseBoth, filter, edge]) {
      expect(action).toHaveBeenCalledOnce();
    }
  } finally {
    vi.useRealTimers();
  }
});

it("reverses a selected edge with T and preserves sequences containing T", async () => {
  vi.useFakeTimers();
  try {
    const reverse = vi.fn();
    const convert = vi.fn();
    const tag = vi.fn();
    let selected = false;
    config.project = Object.create(Project.prototype);
    allKeyBinds.push(
      { id: "reverseEdges", defaultKey: "t", onPress: reverse, when: () => selected, isToggle: true, icon: Redo },
      { id: "switchEdgeToArcEdge", defaultKey: "e t a", onPress: convert, when: () => selected, icon: Redo },
      { id: "changeTagBySelected", defaultKey: "t a g g", onPress: tag, when: () => selected, icon: Redo },
    );
    await KeyBindsUI.registerAllUIKeyBinds();
    KeyBindsUI.uiStartListen();
    const press = async (key: string, repeat = false) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, repeat }));
      await vi.advanceTimersByTimeAsync(0);
    };

    await press("t");
    await vi.advanceTimersByTimeAsync(250);
    expect(reverse).not.toHaveBeenCalled();

    selected = true;
    await press("t");
    await press("t", true);
    await vi.advanceTimersByTimeAsync(250);
    expect(reverse).toHaveBeenCalledOnce();

    for (const key of ["e", "t", "a"]) await press(key);
    for (const key of ["t", "a", "g", "g"]) await press(key);
    await vi.advanceTimersByTimeAsync(250);
    expect(convert).toHaveBeenCalledOnce();
    expect(tag).toHaveBeenCalledOnce();
    expect(reverse).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])("blocks native macOS history on the canvas with Shift=%s and leaves text alone", (shiftKey) => {
  config.isMac = true;
  config.project = Object.create(Project.prototype);
  KeyBindsUI.uiStartListen();
  const key = () =>
    new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey, bubbles: true, cancelable: true });
  const canvas = document.createElement("canvas");
  const textarea = document.createElement("textarea");
  canvas.tabIndex = 0;
  document.body.append(canvas, textarea);

  canvas.focus();
  expect(canvas.dispatchEvent(key())).toBe(false);

  textarea.focus();
  expect(textarea.dispatchEvent(key())).toBe(true);
});
