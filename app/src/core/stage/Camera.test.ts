import { describe, expect, it, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import type { Project } from "@/core/Project";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (value: unknown) => value }));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    moveAmplitude: 2,
    moveFriction: 0.1,
    scaleExponent: 0.2,
    scaleCameraByMouseLocation: true,
    cameraResetViewPaddingRate: 1,
    cameraResetMaxScale: 5,
  },
}));
vi.mock("../service/feedbackService/SoundService", () => ({
  SoundService: { play: { viewAdjustSoundFile: vi.fn() } },
}));
vi.mock("@/core/stage/stageObject/abstract/StageEntity", () => ({ Entity: class {} }));
import { Camera } from "./Camera";

describe("fit view", () => {
  it.each([1, 0.5])("keeps 15 px on all sides at UI scale %s and restores the previous view", (uiScale) => {
    const w = 1000;
    const h = 600;
    const center = new Vector(400, -200);
    const size = new Vector(w - 30 / uiScale, h - 30 / uiScale).multiply(2);
    const camera = new Camera({
      renderer: { w, h },
      canvas: { viewToClientScale: () => new Vector(uiScale, uiScale) },
      stageManager: { getCenter: () => center, getSize: () => size, getSelectedEntities: () => [] },
    } as unknown as Project);
    const original = new Vector(123, 456);
    camera.location = original.clone();
    camera.currentScale = 2;
    camera.targetScale = 3;

    camera.toggleFitView();
    expect(camera.location).toEqual(center);
    expect(((w - size.x * camera.currentScale) / 2) * uiScale).toBeCloseTo(15);
    expect(((h - size.y * camera.currentScale) / 2) * uiScale).toBeCloseTo(15);

    camera.toggleFitView();
    expect(camera.location).toEqual(original);
    expect(camera.currentScale).toBe(2);
    expect(camera.targetScale).toBe(2);
    camera.toggleFitView();
    expect(camera.location).toEqual(center);
    expect(camera.currentScale).toBe(0.5);
  });

  it("fits a new selection after moving the view and records the latest position", () => {
    const bounds = new Rectangle(new Vector(60, 90), new Vector(200, 100));
    const selected = vi.fn(() => [{ collisionBox: { getRectangle: () => bounds } }]);
    const camera = new Camera({
      renderer: { w: 800, h: 400 },
      canvas: { viewToClientScale: () => new Vector(1, 1) },
      stageManager: {
        getSelectedEntities: selected,
        getCenter: () => Vector.getZero(),
        getSize: () => new Vector(2000, 1000),
      },
    } as unknown as Project);
    camera.toggleFitView();
    expect(camera.location).toEqual(bounds.center);
    expect(camera.currentScale).toBe(4);

    camera.panByViewDelta(new Vector(60, 80));
    const moved = camera.location.clone();
    const nextBounds = new Rectangle(new Vector(-100, 30), new Vector(400, 100));
    selected.mockReturnValue([{ collisionBox: { getRectangle: () => nextBounds } }]);
    camera.toggleFitView();
    expect(camera.location).toEqual(nextBounds.center);
    expect(camera.currentScale).toBe(2);
    camera.toggleFitView();
    expect(camera.location).toEqual(Vector.getZero());
    camera.toggleFitView();
    expect(camera.location).toEqual(nextBounds.center);
    camera.restoreCameraState();
    expect(camera.location).toEqual(moved);
    expect(camera.currentScale).toBe(4);
  });

  it.each([false, true])("fits a newly selected range from a fitted view (same bounds: %s)", (sameBounds) => {
    const firstBounds = new Rectangle(new Vector(60, 90), new Vector(200, 100));
    const secondBounds = sameBounds ? firstBounds : new Rectangle(new Vector(-240, 70), new Vector(300, 160));
    const selected = vi.fn(() => [
      { uuid: "first", selectionOrder: 1, collisionBox: { getRectangle: () => firstBounds } },
    ]);
    const center = new Vector(400, 200);
    const camera = new Camera({
      renderer: { w: 800, h: 400 },
      canvas: { viewToClientScale: () => new Vector(1, 1) },
      stageManager: {
        getSelectedEntities: selected,
        getCenter: () => center,
        getSize: () => new Vector(1540, 740),
      },
    } as unknown as Project);
    camera.toggleFitView();
    expect(camera.location).toEqual(firstBounds.center);

    selected.mockReturnValue([
      { uuid: "second", selectionOrder: 2, collisionBox: { getRectangle: () => secondBounds } },
    ]);
    camera.toggleFitView();
    expect(camera.location).toEqual(secondBounds.center);
    camera.toggleFitView();
    expect(camera.location).toEqual(center);
    expect(camera.currentScale).toBe(0.5);
    camera.toggleFitView();
    expect(camera.location).toEqual(secondBounds.center);
  });
});

describe("camera after direct gestures", () => {
  it("fits the project even when the canvas mounts after the first ten frames", () => {
    const renderer = { w: 0, h: 0, transformWorld2View: () => Vector.getZero() };
    const center = new Vector(4000, -3000);
    const getCenter = vi.fn(() => center.clone());
    const camera = new Camera({
      renderer,
      stageManager: { getCenter, getSize: () => new Vector(2000, 1000) },
    } as unknown as Project);
    for (let i = 0; i < 30; i++) camera.tick();
    expect(getCenter).not.toHaveBeenCalled();
    renderer.w = 1000;
    renderer.h = 500;
    camera.tick();
    expect(camera.location).toEqual(center);
    expect(camera.currentScale).toBe(0.5);
    for (let i = 0; i < 30; i++) camera.tick();
    expect(getCenter).toHaveBeenCalledOnce();
  });
  it("keeps the exact scale and location over idle frames", () => {
    const renderer = { transformWorld2View: vi.fn(() => new Vector(50, 50)) };
    const camera = new Camera({ renderer } as unknown as Project);
    Object.assign(camera, { hasResetOnOpen: true });
    camera.location = new Vector(689.852530163047, -790.7953028402999);
    camera.currentScale = camera.targetScale = 0.07422735362687596;
    const location = camera.location.clone();
    for (let i = 0; i < 240; i++) camera.tick();
    expect(camera.currentScale).toBe(0.07422735362687596);
    expect(camera.targetScale).toBe(camera.currentScale);
    expect(camera.location).toEqual(location);
  });
});
