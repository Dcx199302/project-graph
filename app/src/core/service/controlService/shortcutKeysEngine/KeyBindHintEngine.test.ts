import type { Project } from "@/core/Project";
import { Vector } from "@graphif/data-structures";
import { afterEach, expect, it, vi } from "vitest";
import { KeyBindHintEngine } from "./KeyBindHintEngine";
import { KeyBindsUI, type UIKeyBind } from "./KeyBindsUI";
import { allKeyBinds } from "./shortcutKeysRegister";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: { showKeyBindHint: true, uiScalePercent: 100 } }));
vi.mock("@/utils/font", () => ({ getTextSize: () => new Vector(100, 20) }));
vi.mock("@/utils/platform", () => ({ isMac: true }));
vi.mock("i18next", () => ({ default: { t: (key: string) => key } }));
vi.mock("./shortcutKeysRegister", () => ({ allKeyBinds: [] }));
vi.mock("./KeyBindsUI", () => ({ KeyBindsUI: { getAllUIKeyBinds: vi.fn() } }));

afterEach(() => {
  allKeyBinds.length = 0;
});

function setup() {
  const bindings: UIKeyBind[] = [];
  vi.mocked(KeyBindsUI.getAllUIKeyBinds).mockReturnValue(bindings);
  const pressingKeySet = new Set<string>();
  const renderText = vi.fn<(text: string) => void>();
  const project = {
    controller: { pressingKeySet },
    renderer: { h: 800 },
    stageStyleManager: { currentStyle: { effects: {} } },
    textRenderer: { renderText },
  } as unknown as Project;
  const engine = new KeyBindHintEngine(project);

  function register(id: string, key: string, options: Partial<UIKeyBind> = {}) {
    allKeyBinds.push({ id, defaultKey: key || "S-M-u" } as (typeof allKeyBinds)[number]);
    bindings.push({ id, key, isEnabled: true, when: () => true, onPress: vi.fn(), ...options });
  }
  async function showHints(...keys: string[]) {
    pressingKeySet.clear();
    for (const key of keys) pressingKeySet.add(key);
    engine.update();
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderText.mockClear();
    engine.render();
    return renderText.mock.calls.map(([text]) => text);
  }
  return { engine, register, showHints };
}

it("shows only configured and available shortcuts starting with the held Mac modifiers", async () => {
  const { engine, register, showHints } = setup();
  engine.registerToolbarShortcuts({ actionIds: new Set(["toolbarAction"]), numberedKeys: new Set() });
  register("retained", "M-S-k");
  register("toolbarAction", "S-M-y");
  register("inactive", "S-M-a", { when: async () => false });
  register("disabled", "S-M-b", { isEnabled: false });
  register("unassigned", "");
  register("laterModifiers", "u S-M-d");
  register("modifierOnly", "S-M-shift");
  register("anotherModifier", "C-S-f");
  allKeyBinds.push({ id: "unregistered", defaultKey: "S-M-u" } as (typeof allKeyBinds)[number]);

  expect(await showHints("meta", "shift")).toEqual(["⇧ + ⌘ + k", "retained.title"]);
  expect(await showHints("control", "shift")).toEqual(["⌃ + ⇧ + f", "anotherModifier.title"]);
});

it("checks availability again on re-press and hides keys intercepted by the layout menu", async () => {
  const { engine, register, showHints } = setup();
  const disposeToolbar = engine.registerToolbarShortcuts({
    actionIds: new Set(["layoutToSquareVertical"]),
    numberedKeys: new Set(["C-2", "A-1"]),
  });
  let selected = false;
  register("layoutToSquareVertical", "C-2");
  register("shadowed", "C-2");
  register("shadowedSequence", "C-y A-1");
  register("move", "C-m", { when: () => selected });
  register("save", "C-s");
  expect(await showHints("control")).toEqual(["⌃ + s", "save.title"]);
  expect(await showHints()).toEqual([]);
  selected = true;
  expect(await showHints("control")).toEqual(["⌃ + m", "move.title", "⌃ + s", "save.title"]);

  disposeToolbar();
  expect(await showHints("control")).toContain("shadowed.title");
});
