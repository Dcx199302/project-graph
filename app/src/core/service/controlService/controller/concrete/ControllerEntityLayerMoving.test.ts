import type { Project } from "@/core/Project";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { expect, it, vi } from "vitest";
import { ControllerLayerMovingClass } from "./ControllerEntityLayerMoving";

vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: {} }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({ TextNode: class {} }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { play: { entityJumpSoundFile: vi.fn() } },
}));

it("moves selected entities only once after activating Jump To and clicking the destination", () => {
  const rectangle = new Rectangle(new Vector(10, 20), new Vector(100, 80));
  const node = { collisionBox: { getRectangle: () => rectangle } };
  const move = vi.fn();
  const recordStep = vi.fn();
  const isCreating = vi.fn(() => false);
  const project = {
    canvas: { element: {} },
    controller: { resetCountdownTimer: vi.fn(), pressingKeySet: new Set(["alt"]) },
    keyboardOnlyEngine: { isOpenning: () => true },
    keyboardOnlyGraphEngine: { isCreating },
    renderer: { transformView2World: (point: Vector) => point.divide(2) },
    stageManager: { getSelectedEntities: () => [node], findEntityByLocation: () => null },
    sectionMethods: { getInnermostSectionByLocation: () => null, isObjectBeLockedBySection: () => false },
    entityMoveManager: { moveSelectedEntities: move },
    effects: { addEffect: vi.fn() },
    historyManager: { recordStep },
    loop: vi.fn(),
  } as unknown as Project;
  const jump = new ControllerLayerMovingClass(project);
  const pointer = { clientX: 200, clientY: 300, button: 0, altKey: true } as PointerEvent;

  jump.mousemove(pointer);
  jump.mouseup(pointer);
  expect(jump.targetLocation).toBeUndefined();
  expect(move).not.toHaveBeenCalled();
  project.controller.pressingKeySet.clear();

  isCreating.mockReturnValueOnce(true);
  jump.toggleJump();
  expect(jump.isActive).toBe(false);

  jump.toggleJump();
  jump.mousemove({ ...pointer, clientX: 180, altKey: false });
  expect(jump.targetLocation).toEqual(new Vector(90, 150));
  expect(jump.cancelJump()).toBe(true);
  jump.jumpAt(pointer);
  expect(move).not.toHaveBeenCalled();

  jump.toggleJump();
  jump.jumpAt({ ...pointer, altKey: false });
  jump.jumpAt({ ...pointer, altKey: false });
  expect(move).toHaveBeenCalledExactlyOnceWith(new Vector(90, 130));
  expect(recordStep).toHaveBeenCalledOnce();
  expect(jump.isActive).toBe(false);
});
