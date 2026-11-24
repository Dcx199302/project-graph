import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Vector } from "@graphif/data-structures";
import { beforeEach, expect, it, vi } from "vitest";
import { ControllerEntityClickSelectAndMoveClass } from "./ControllerEntityClickSelectAndMove";

vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/stage/stageObject/abstract/StageEntity", () => ({ Entity: class {} }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/service/dataManageService/connectNodeSmartTools", () => ({ ConnectNodeSmartTools: {} }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleNoteEffect", () => ({
  RectangleNoteEffect: {},
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleRenderEffect", () => ({
  RectangleRenderEffect: {},
}));
vi.mock("@/utils/platform", () => ({ isMac: false }));

beforeEach(() => {
  Settings.mouseLeftMode = "selectAndMove";
  Settings.viewerMode = false;
});

function setup() {
  const node = Object.assign(Object.create(Entity.prototype), { isSelected: false }) as Entity;
  const clicked = vi.fn<() => Entity | null>(() => node);
  const move = vi.fn();
  const history = vi.fn();
  const selection = vi.fn();
  const project = {
    camera: { stopImmediately: vi.fn() },
    controller: {
      isCameraLocked: false,
      pressingKeySet: new Set<string>(),
      camera: { isPreGrabbingWhenSpace: false },
      rectangleSelect: { isUsing: false },
      cutting: { isUsing: false },
      setCursorName: vi.fn(),
    },
    controllerUtils: { getClickedStageObject: clicked, isClickedResizeRect: () => false },
    sectionMethods: {
      getOutermostLockedAncestorSection: () => null,
      isObjectBeLockedBySection: () => false,
    },
    stageManager: {
      getStageObjects: () => [node],
      clearSelectAll: selection,
      isHaveEntitySelected: () => node.isSelected,
    },
    renderer: { transformView2World: (point: Vector) => point.divide(2) },
    entityMoveManager: { moveSelectedEntities: move },
    historyManager: { recordStep: history },
  } as unknown as Project;
  const control = new ControllerEntityClickSelectAndMoveClass(project);
  const pointer = (button: number, clientX = 0, pointerType = "mouse") =>
    ({ button, clientX, clientY: 0, pointerType }) as PointerEvent;
  return { node, clicked, move, history, selection, control, pointer };
}

it("selects with the left mouse button without dragging nodes in Select mode", () => {
  const { control, node, pointer, move, history } = setup();
  expect(control.tryStartDrag(pointer(0))).toBe(false);
  control.mousedown(pointer(0));
  control.mousemove(pointer(0, 80));
  control.mouseup(pointer(0, 80));
  expect(node.isSelected).toBe(true);
  expect(move).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
});

it.each([
  [1, "selectAndMove"],
  [0, "drag"],
] as const)("drags nodes with button %i in %s mode until release", (button, mode) => {
  const { control, node, clicked, pointer, move, history } = setup();
  Settings.mouseLeftMode = mode;
  expect(control.tryStartDrag(pointer(button))).toBe(true);
  expect(node.isSelected).toBe(false);
  control.mousemove(pointer(button, 3));
  expect(move).not.toHaveBeenCalled();
  clicked.mockReturnValue(null);
  control.mousemove(pointer(button, 80));
  expect(node.isSelected).toBe(true);
  expect(move).toHaveBeenCalledExactlyOnceWith(new Vector(40, 0));
  control.mouseup(pointer(button, 80));
  control.mousemove(pointer(button, 90));
  expect(move).toHaveBeenCalledOnce();
  expect(history).toHaveBeenCalledOnce();
  expect(control.tryStartDrag(pointer(button))).toBe(false);
});

it("does not move or select on a middle click and clears an active drag on cancel", () => {
  const { control, node, pointer, move, history, selection } = setup();
  control.tryStartDrag(pointer(1));
  control.mouseup(pointer(1, 2));
  expect(node.isSelected).toBe(false);
  expect(selection).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  control.tryStartDrag(pointer(1));
  control.mousemove(pointer(1, 40));
  control.mouseMoveOutWindowForcedShutdown(Vector.getZero());
  control.mousemove(pointer(1, 80));
  expect(move).toHaveBeenCalledExactlyOnceWith(new Vector(20, 0));
  expect(history).toHaveBeenCalledOnce();
});
