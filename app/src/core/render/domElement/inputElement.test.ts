// @vitest-environment jsdom

import type { Project } from "@/core/Project";
import { KeyBindsUI } from "@/core/service/controlService/shortcutKeysEngine/KeyBindsUI";
import { afterEach, expect, it, vi } from "vitest";
import { InputElement } from "./inputElement";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (value: unknown) => value }));
vi.mock("@/core/service/controlService/shortcutKeysEngine/KeyBindsUI", () => ({
  KeyBindsUI: { getUIKeyBind: vi.fn() },
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/EntityShakeEffect", () => ({ EntityShakeEffect: {} }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleLittleNoteEffect", () => ({
  RectangleLittleNoteEffect: {},
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    textNodeBackspaceDeleteWhenEmpty: true,
    textNodeExitEditMode: "enter",
    textNodeContentLineBreak: "shiftEnter",
    enableBackslashGenerateNodeInInput: true,
  },
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.resetAllMocks();
});

it("keeps an empty edge label editable when backspace would delete a selected node", async () => {
  const removeSelection = vi.fn();
  const change = vi.fn();
  const input = new InputElement({
    stageManager: { deleteSelectedStageObjects: removeSelection },
    controller: { resetCountdownTimer: vi.fn() },
  } as unknown as Project);
  const onMount = vi.fn();
  const result = input.textarea("", change, {}, true, false, { edgeLabel: onMount });
  const editor = document.activeElement as HTMLTextAreaElement;
  expect(onMount).toHaveBeenCalledWith(editor, expect.any(Function));
  expect(editor.rows).toBe(1);

  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace" }));
  expect(editor.isConnected).toBe(true);
  expect(removeSelection).not.toHaveBeenCalled();
  editor.value = "连线\n标签";
  editor.dispatchEvent(new Event("input"));
  expect(change).toHaveBeenCalledWith("连线\n标签", editor);
  expect(editor.rows).toBe(2);
  editor.value = "连线";
  editor.dispatchEvent(new Event("input"));
  expect(editor.rows).toBe(1);
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  await expect(result).resolves.toBe("连线");
  expect(editor.isConnected).toBe(false);
});

it("keeps Enter and Shift+Enter available for submission and line breaks in the node editor", async () => {
  const growSibling = vi.fn();
  vi.mocked(KeyBindsUI.getUIKeyBind).mockImplementation((id) =>
    id === "generateNodeTreeWithBroadMode"
      ? ({ key: "enter", isEnabled: true } as ReturnType<typeof KeyBindsUI.getUIKeyBind>)
      : undefined,
  );
  const input = new InputElement({
    camera: { isDefaultZoom: () => false },
    stageManager: {
      getConnectableEntity: () => [{ isSelected: true }],
    },
    graphMethods: { isCurrentNodeInTreeStructAndNotRoot: () => true },
    keyboardOnlyTreeEngine: { onBroadGenerateNode: growSibling },
  } as unknown as Project);
  const result = input.textarea("第一行", vi.fn(), {}, false, false);
  const editor = document.activeElement as HTMLTextAreaElement;
  editor.setSelectionRange(editor.value.length, editor.value.length);
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true }));
  expect(editor.value).toBe("第一行\n");
  expect(editor.isConnected).toBe(true);
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  await expect(result).resolves.toBe("第一行\n");
  expect(growSibling).not.toHaveBeenCalled();
});

it.each([
  ["Top", "ArrowUp"],
  ["Right", "ArrowRight"],
  ["Left", "ArrowLeft"],
  ["Down", "ArrowDown"],
])("commits node text and continues editing a new node with Alt+%s", async (direction, key) => {
  const project = {} as Project;
  const input = new InputElement(project);
  const commit = vi.fn();
  const result = input.textarea("初始文字", commit);
  const editor = document.activeElement as HTMLTextAreaElement;
  let nextResult: Promise<string> | undefined;
  const onPress = vi.fn(() => {
    expect(commit).toHaveBeenCalledWith("编辑后的文字", editor);
    expect(editor.isConnected).toBe(false);
    nextResult = input.textarea("新节点");
  });
  vi.mocked(KeyBindsUI.getUIKeyBind).mockImplementation((id) =>
    id === `createTextNodeFromSelected${direction}`
      ? { key: `A-${key.toLowerCase()}`, isEnabled: true, when: () => true, onPress, id }
      : undefined,
  );

  editor.value = "编辑后的文字";
  const event = new KeyboardEvent("keydown", { key, altKey: true, cancelable: true });
  expect(editor.dispatchEvent(event)).toBe(false);
  expect(onPress).toHaveBeenCalledExactlyOnceWith(project);
  await expect(result).resolves.toBe("编辑后的文字");

  const nextEditor = document.activeElement as HTMLTextAreaElement;
  expect(nextEditor.value).toBe("新节点");
  nextEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  await expect(nextResult).resolves.toBe("新节点");
});

it.each([
  { isEnabled: false },
  { allowed: false },
  { edgeLabel: true },
  { isComposing: true },
  { altKey: false },
  { repeat: true },
])("keeps editing without creating a node for %j", async (options) => {
  const onPress = vi.fn();
  const id = "createTextNodeFromSelectedLeft";
  vi.mocked(KeyBindsUI.getUIKeyBind).mockImplementation((requestedId) =>
    requestedId === id
      ? { id, key: "A-arrowleft", isEnabled: options.isEnabled ?? true, when: () => options.allowed ?? true, onPress }
      : undefined,
  );
  const input = new InputElement({} as Project);
  const result = input.textarea("节点文本", undefined, {}, true, false, {
    edgeLabel: options.edgeLabel ? vi.fn() : undefined,
  });
  const editor = document.activeElement as HTMLTextAreaElement;
  const event = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    altKey: options.altKey ?? true,
    isComposing: options.isComposing,
    repeat: options.repeat,
    cancelable: true,
  });
  expect(editor.dispatchEvent(event)).toBe(!options.repeat);
  expect(onPress).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(editor);
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  await expect(result).resolves.toBe("节点文本");
});

it.each([
  { key: "z", metaKey: true },
  { key: "Z", metaKey: true, shiftKey: true },
  { key: "z", ctrlKey: true },
  { key: "y", ctrlKey: true },
])("keeps the editor open and leaves text history to the browser for %j", async (shortcut) => {
  vi.useFakeTimers();
  try {
    const input = new InputElement({} as Project);
    const result = input.textarea("节点文本");
    const editor = document.activeElement as HTMLTextAreaElement;
    const event = new KeyboardEvent("keydown", { ...shortcut, bubbles: true, cancelable: true });

    editor.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(20);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(editor);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    await expect(result).resolves.toBe("节点文本");
  } finally {
    vi.useRealTimers();
  }
});
