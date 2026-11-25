// @vitest-environment jsdom

import type { Project } from "@/core/Project";
import { InputElement } from "@/core/render/domElement/inputElement";
import { Settings } from "@/core/service/Settings";
import type { Section } from "@/core/stage/stageObject/entity/Section";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { expect, it, vi } from "vitest";
import { ControllerUtils } from "./utilsControl";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (value: unknown) => value }));
vi.mock("@/core/TabWorkspace", () => ({}));
vi.mock("@/core/render/canvas2d/renderer", () => ({
  Renderer: { FONT_SIZE: 32, NODE_PADDING: 14, NODE_ROUNDED_RADIUS: 6 },
}));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/service/controlService/shortcutKeysEngine/KeyBindsUI", () => ({}));
vi.mock("@/core/stage/stageObject/entity/ReferenceBlockNode", () => ({}));
vi.mock("@/core/stage/stageObject/entity/MediaNode", () => ({}));
vi.mock("@/core/stage/stageObject/entity/SvgNode", () => ({}));
vi.mock("./utilsControlTools", () => ({ AutoCompleteManager: class {} }));

function setup(isOverview: boolean, worldLocation: Vector, text = "原来的分组名") {
  const canvasBounds = new DOMRect(100, 50, 500, 300);
  const cameraScale = isOverview ? 0.1 : 1;
  const rectangle = new Rectangle(worldLocation, new Vector(500, 200));
  const section = {
    text,
    rectangle,
    isEditingTitle: false,
    rename(newTitle: string) {
      this.text = newTitle;
    },
  };
  const recordStep = vi.fn();
  const project = {
    camera: { currentScale: cameraScale, stopImmediately: vi.fn() },
    canvas: {
      element: { getBoundingClientRect: () => canvasBounds },
      viewToClient: (point: Vector) => point.multiply(0.5).add(new Vector(canvasBounds.left, canvasBounds.top)),
      viewToClientScale: () => Vector.same(0.5),
    },
    controller: { isCameraLocked: false, resetCountdownTimer: vi.fn() },
    historyManager: { recordStep },
    renderer: {
      transformWorld2View: (value: Vector | Rectangle) =>
        value instanceof Rectangle
          ? new Rectangle(value.location.multiply(cameraScale), value.size.multiply(cameraScale))
          : value.multiply(cameraScale),
    },
    sectionMethods: { isObjectBeLockedBySection: () => false, isSectionBigTitleActive: () => isOverview },
    stageStyleManager: {
      currentStyle: {
        Background: Color.White,
        StageObjectBorder: Color.Black,
        effects: { successShadow: Color.Green },
      },
    },
    loop: vi.fn(),
  } as unknown as Project;
  project.inputElement = new InputElement(project);

  const result = new ControllerUtils(project).editSectionTitle(section as Section);
  const input = document.activeElement as HTMLTextAreaElement;
  return { canvasBounds, section, input, project, recordStep, result };
}

it.each(["cover", "top"] as const)("shows a readable %s title editor within the canvas before Enter", async (mode) => {
  Settings.sectionBitTitleRenderType = mode;
  const point = mode === "cover" ? new Vector(9900, 5900) : new Vector(3000, 2800);
  const { canvasBounds, section, input, project, recordStep, result } = setup(true, point);

  expect(input).toBeInstanceOf(HTMLTextAreaElement);
  expect(input.value).toBe("原来的分组名");
  expect(section.isEditingTitle).toBe(true);
  expect(input.style.fontSize).toBe("16px");
  expect(input.style.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(parseFloat(input.style.left)).toBeGreaterThanOrEqual(canvasBounds.left);
  expect(parseFloat(input.style.left) + parseFloat(input.style.width)).toBeLessThanOrEqual(canvasBounds.right);
  expect(parseFloat(input.style.top)).toBeGreaterThanOrEqual(canvasBounds.top);
  expect(parseFloat(input.style.top) + parseFloat(input.style.height)).toBeLessThanOrEqual(canvasBounds.bottom);
  if (mode === "top") expect(parseFloat(input.style.top) + parseFloat(input.style.height)).toBeLessThan(190);

  input.value = "改名后立即可见";
  input.dispatchEvent(new Event("input"));
  expect(section.text).toBe(input.value);
  expect(input.isConnected).toBe(true);
  expect(recordStep).not.toHaveBeenCalled();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await result;

  expect(input.isConnected).toBe(false);
  expect(section.isEditingTitle).toBe(false);
  expect(project.controller.isCameraLocked).toBe(false);
  expect(recordStep).toHaveBeenCalledOnce();
});

it("keeps the normal editor at the scaled title and retains an unchanged multiline title", async () => {
  const title = "原来的分组名\n第二行";
  const { section, input, recordStep, result } = setup(false, new Vector(100, 100), title);
  expect(input.style.fontSize).toBe("16px");
  expect(input.style.left).toBe("157px");
  expect(input.style.width).toBe("236px");
  expect(input.value).toBe(title);

  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await result;
  expect(section.text).toBe(title);
  expect(recordStep).not.toHaveBeenCalled();
});

it("preserves existing line breaks during edits and inserts a new line with Shift+Enter", async () => {
  Settings.sectionBitTitleRenderType = "cover";
  const { section, input, result, recordStep } = setup(true, new Vector(400, 200), "第一行\n第二行");
  expect(input.value).toBe("第一行\n第二行");
  input.value = "修改第一行\n第二行";
  input.dispatchEvent(new Event("input"));
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true }));
  expect(input.value).toBe("修改第一行\n第二行\n");
  expect(input.isConnected).toBe(true);

  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await result;
  expect(section.text).toBe("修改第一行\n第二行\n");
  expect(recordStep).toHaveBeenCalledOnce();
});
