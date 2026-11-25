import type { Project } from "@/core/Project";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { expect, it, vi } from "vitest";
import { LayoutManager } from "./LayoutManager";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/stage/stageObject/abstract/StageEntity", () => ({ Entity: class {} }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({ TextNode: class {} }));

function createNode(x: number, y: number, width: number, height: number) {
  const rect = new Rectangle(new Vector(x, y), new Vector(width, height));
  const node = Object.assign(Object.create(ConnectableEntity.prototype), {
    collisionBox: { getRectangle: () => rect },
    moveTo: vi.fn((location: Vector) => {
      rect.location = location;
    }),
  }) as ConnectableEntity;
  return { node, rect };
}

it("keeps the hub centered and leaves wide gaps between other nodes on the rectangle", () => {
  const hub = createNode(60, 40, 200, 120);
  const outer = [
    createNode(80, 120, 180, 80),
    createNode(-20, -90, 90, 100),
    createNode(220, 460, 130, 70),
    createNode(20, 350, 70, 60),
    createNode(460, 0, 150, 110),
  ];
  const items = [hub, ...outer];
  const recordStep = vi.fn();
  const project = {
    stageManager: {
      getSelectedEntities: () => items.map(({ node }) => node),
      getEdges: () => outer.map(({ node }) => ({ source: hub.node, target: node })),
    },
    historyManager: { recordStep },
    sectionMoveDepth: 0,
  } as unknown as Project;
  const layout = new LayoutManager(project);
  const origin = hub.rect.center;
  layout.arrangeSelectedRectangle();
  expect(hub.rect.center).toEqual(origin);

  const offsets = outer.map(({ rect }) => rect.center.subtract(origin));
  const halfWidth = Math.max(...offsets.map(({ x }) => Math.abs(x)));
  const halfHeight = Math.max(...offsets.map(({ y }) => Math.abs(y)));
  expect(halfWidth).toBeGreaterThan(halfHeight);
  expect(halfHeight).toBeCloseTo(246 * 1.12 ** 6);
  for (const { x, y } of offsets) {
    expect(Math.min(Math.abs(Math.abs(x) - halfWidth), Math.abs(Math.abs(y) - halfHeight))).toBeCloseTo(0);
  }
  for (const [index, { rect }] of items.entries()) {
    for (const { rect: other } of items.slice(index + 1)) {
      const gap = Math.max(
        other.left - rect.right,
        rect.left - other.right,
        other.top - rect.bottom,
        rect.top - other.bottom,
      );
      expect(gap).toBeGreaterThan(300);
    }
  }
  layout.arrangeSelectedRectangle();
  expect(recordStep).toHaveBeenCalledOnce();
});

it("leaves the middle of a rectangular layout empty when no node connects to all the others", () => {
  const items = Array.from({ length: 6 }, (_, index) => createNode(index * 31, index * 5, 60, 50));
  const center = Rectangle.getBoundingRectangle(items.map(({ rect }) => rect)).center;
  const recordStep = vi.fn();
  const layout = new LayoutManager({
    stageManager: { getSelectedEntities: () => items.map(({ node }) => node), getEdges: () => [] },
    historyManager: { recordStep },
    sectionMoveDepth: 0,
  } as unknown as Project);
  layout.arrangeSelectedRectangle();
  const bounds = Rectangle.getBoundingRectangle(items.map(({ rect }) => rect));
  expect(bounds.center.distance(center)).toBeCloseTo(0);
  for (const { rect } of items) expect(rect.center.distance(center)).toBeGreaterThan(rect.size.magnitude() / 2);
  layout.arrangeSelectedRectangle();
  expect(recordStep).toHaveBeenCalledOnce();
});
