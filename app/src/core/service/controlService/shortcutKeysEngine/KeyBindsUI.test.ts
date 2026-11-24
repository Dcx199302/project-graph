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
  allKeyBinds.length = 0;
  KeyBindsUI.unregisterOneUIKeyBind("redo");
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
