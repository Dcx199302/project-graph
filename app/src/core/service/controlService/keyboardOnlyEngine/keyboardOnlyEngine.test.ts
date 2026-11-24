// @vitest-environment jsdom

import type { Project } from "@/core/Project";
import { expect, it, vi } from "vitest";
import { KeyboardOnlyEngine } from "./keyboardOnlyEngine";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: { textNodeStartEditMode: "space" } }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleLittleNoteEffect", () => ({
  RectangleLittleNoteEffect: { fromUtilsLittleNote: vi.fn() },
}));

it("edits on a space tap and ignores space used to drag even after releasing the mouse", () => {
  vi.useFakeTimers();
  const canvas = document.createElement("canvas");
  const selectedNode = { isSelected: true };
  const editTextNode = vi.fn();
  const engine = new KeyboardOnlyEngine({
    canvas: { element: canvas },
    stageManager: { getTextNodes: () => [selectedNode] },
    controller: { isMouseDown: [false, false, false] },
    controllerUtils: { editTextNode },
    effects: { addEffect: vi.fn() },
    stageStyleManager: { currentStyle: { effects: {} } },
  } as unknown as Project);
  const key = (type: string, key: string, repeat = false) =>
    canvas.dispatchEvent(new KeyboardEvent(type, { key, repeat, cancelable: true }));
  try {
    key("keydown", " ");
    canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0 }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    key("keydown", " ", true);
    key("keyup", " ");
    key("keydown", "Enter");
    vi.runAllTimers();
    expect(editTextNode).not.toHaveBeenCalled();

    expect(key("keydown", " ")).toBe(false);
    vi.runAllTimers();
    expect(editTextNode).not.toHaveBeenCalled();
    key("keyup", " ");
    vi.runAllTimers();
    expect(editTextNode).toHaveBeenCalledExactlyOnceWith(selectedNode, undefined);
  } finally {
    engine.dispose();
    vi.useRealTimers();
  }
});
