import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { deserialize, serialize } from "@graphif/serializer";
import { decode, encode } from "@msgpack/msgpack";
import { Rectangle, SymmetryCurve } from "@graphif/shapes";

const setting = vi.hoisted(() => ({ style: (() => {}) as (value: string) => void }));
vi.mock("@/core/Project", () => ({ Project: class {} }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 24 } }));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    enableAutoEdgeWidth: false,
    watch: (_key: string, callback: (value: string) => void) => {
      setting.style = callback;
      callback("bezier");
    },
  },
}));
vi.mock("@/utils/font", () => ({ getMultiLineTextSize: () => new Vector(20, 20) }));
vi.mock("../abstract/ConnectableEntity", () => ({ ConnectableEntity: class {} }));
vi.mock("../entity/ConnectPoint", () => ({ ConnectPoint: class {} }));
vi.mock("../entity/TextNode", () => ({ TextNode: class {} }));
vi.mock("../entity/Section", () => ({ Section: class {} }));
vi.mock("../entity/ImageNode", () => ({ ImageNode: class {} }));

import { CollisionBox } from "../collisionBox/collisionBox";
import { TextNode } from "../entity/TextNode";
import { Section } from "../entity/Section";
import { LineEdge } from "./LineEdge";
import { EdgeCollisionBoxGetter } from "./EdgeCollisionBoxGetter";
import { Settings } from "@/core/service/Settings";

function node(x: number) {
  return Object.assign(Object.create(TextNode.prototype), {
    uuid: crypto.randomUUID(),
    collisionBox: new CollisionBox([new Rectangle(new Vector(x, 0), new Vector(100, 80))]),
    getBorderWidth: () => 2,
    clipConnectionToBoundary: true,
  }) as TextNode;
}
function setup() {
  const source = node(0),
    target = node(300);
  const edge = new LineEdge({} as never, { associationList: [source, target] });
  return { source, target, edge };
}
beforeEach(() => {
  EdgeCollisionBoxGetter.init();
  Settings.enableAutoEdgeWidth = false;
});

describe("edge geometry cache", () => {
  it("clips non-center text anchors to node boundaries", () => {
    const { edge } = setup();
    edge.sourceRectangleRate = new Vector(0.25, 0.25);
    edge.targetRectangleRate = new Vector(0.75, 0.25);
    expect(edge.bodyLine.start).toEqual(new Vector(100, 20));
    expect(edge.bodyLine.end).toEqual(new Vector(300, 20));
  });
  it("reuses world geometry while endpoints and connection rates are unchanged", () => {
    const { edge } = setup();
    const line = edge.bodyLine,
      box = edge.collisionBox;
    for (let i = 0; i < 120; i++) {
      expect(edge.bodyLine).toBe(line);
      expect(edge.collisionBox).toBe(box);
    }
  });
  it("invalidates on in-place movement, resizing, rate changes and endpoint replacement", () => {
    const { source, target, edge } = setup();
    let line = edge.bodyLine;
    (source.collisionBox.shapes[0] as Rectangle).location.x += 40;
    expect(edge.bodyLine.start.x).toBe(140);
    expect(edge.bodyLine).not.toBe(line);
    line = edge.bodyLine;
    (target.collisionBox.shapes[0] as Rectangle).size.y += 60;
    expect(edge.bodyLine).not.toBe(line);
    line = edge.bodyLine;
    edge.sourceRectangleRate.y = 0.01;
    expect(edge.bodyLine.start).toEqual(new Vector(140, 40));
    expect(edge.bodyLine).not.toBe(line);
    line = edge.bodyLine;
    edge.target = node(300);
    expect(edge.bodyLine).not.toBe(line);
  });
  it("invalidates collision geometry for line style, offset and width changes", () => {
    const { source, edge } = setup();
    let box = edge.collisionBox;
    setting.style("straight");
    expect(edge.collisionBox).not.toBe(box);
    box = edge.collisionBox;
    edge.shiftingIndex = 1;
    expect(edge.collisionBox).not.toBe(box);
    box = edge.collisionBox;
    setting.style("bezier");
    source.getBorderWidth = () => 8;
    expect(edge.collisionBox).not.toBe(box);
    box = edge.collisionBox;
    Settings.enableAutoEdgeWidth = true;
    expect(edge.collisionBox).not.toBe(box);
  });
  it("refreshes self-loop bounds and section edges after resizing", () => {
    const { source, edge } = setup();
    edge.target = source;
    const box = edge.collisionBox;
    (source.collisionBox.shapes[0] as Rectangle).size.y = 200;
    expect(edge.collisionBox).not.toBe(box);
    expect(edge.collisionBox.getRectangle().height).toBe(200);
    Object.setPrototypeOf(source, Section.prototype);
    expect(edge.collisionBox.getRectangle().height).toBe(200);
  });
});

describe("automatic sides for ordinary directed edges", () => {
  it("follows a moved target without changing direction, saved rates or curve hit geometry", () => {
    const { source, target, edge } = setup();
    edge.sourceRectangleRate = new Vector(0.99, 0.5);
    edge.targetRectangleRate = new Vector(0.01, 0.5);
    const firstBox = edge.collisionBox;
    const targetRect = target.collisionBox.shapes[0] as Rectangle;

    targetRect.location.x = -300;
    expect(edge.bodyLine.start).toEqual(new Vector(0, 40));
    expect(edge.bodyLine.end).toEqual(new Vector(-200, 40));
    expect(edge.collisionBox).not.toBe(firstBox);
    const curve = edge.collisionBox.shapes[0] as SymmetryCurve;
    expect(curve.startDirection).toEqual(new Vector(-1, 0));
    expect(curve.endDirection).toEqual(new Vector(1, 0));

    targetRect.location.x = 0;
    targetRect.location.y = -300;
    expect(edge.bodyLine.start).toEqual(new Vector(50, 0));
    expect(edge.bodyLine.end).toEqual(new Vector(50, -220));
    expect(edge.source).toBe(source);
    expect(edge.target).toBe(target);
    expect(edge.isLeftToRight()).toBe(true);
  });

  it("preserves the original axis in diagonal positions and the saved sides while nodes overlap", () => {
    const { target, edge } = setup();
    edge.sourceRectangleRate = new Vector(0.5, 0.99);
    edge.targetRectangleRate = new Vector(0.5, 0.01);
    const targetRect = target.collisionBox.shapes[0] as Rectangle;

    targetRect.location.y = -180;
    expect(edge.bodyLine.start).toEqual(new Vector(50, 0));
    expect(edge.bodyLine.end).toEqual(new Vector(350, -100));

    targetRect.location.x = 20;
    targetRect.location.y = -20;
    expect(edge.bodyLine.start).toEqual(new Vector(50, 80));
    expect(edge.bodyLine.end).toEqual(new Vector(70, -20));
  });

  it("lets layout edges follow node positions unless their endpoints are manually fixed", () => {
    const { target, edge } = setup();
    edge.sourceRectangleRate = new Vector(0.99, 0.5);
    edge.targetRectangleRate = new Vector(0.01, 0.5);
    edge.graphLayout = "fishbone";
    (target.collisionBox.shapes[0] as Rectangle).location.x = -300;
    const automaticLine = edge.bodyLine;
    expect(automaticLine.start).toEqual(new Vector(0, 40));
    expect(automaticLine.end).toEqual(new Vector(-200, 40));

    edge.fixedEndpoints = true;
    expect(edge.bodyLine).not.toBe(automaticLine);
    expect(edge.bodyLine.start).toEqual(new Vector(100, 40));
    expect(edge.bodyLine.end).toEqual(new Vector(-300, 40));
    const saved = { ...serialize(edge), associationList: [] };
    expect((deserialize(decode(encode(saved)), {}) as LineEdge).fixedEndpoints).toBe(true);

    edge.fixedEndpoints = undefined;
    expect(edge.bodyLine.start).toEqual(automaticLine.start);
    expect(edge.bodyLine.end).toEqual(automaticLine.end);
    expect(edge.graphLayout).toBe("fishbone");
  });

  it.each([
    { sourceRate: new Vector(0.99, 0.5), targetRate: new Vector(0.5, 0.01) },
    { sourceRate: new Vector(0.99, 0.5), targetRate: new Vector(0.99, 0.5) },
    { sourceRate: Vector.same(0.5), targetRate: new Vector(0.01, 0.5) },
  ])("adjusts an edge whose saved sides are mixed, equal or partly centered", ({ sourceRate, targetRate }) => {
    const { target, edge } = setup();
    edge.sourceRectangleRate = sourceRate;
    edge.targetRectangleRate = targetRate;
    (target.collisionBox.shapes[0] as Rectangle).location.x = -300;

    expect(edge.bodyLine.start).toEqual(new Vector(0, 40));
    expect(edge.bodyLine.end).toEqual(new Vector(-200, 40));
    expect(edge.sourceRectangleRate).toEqual(sourceRate);
    expect(edge.targetRectangleRate).toEqual(targetRate);
  });
});

it("preserves graph layout on reload and recognizes the legacy fishbone flag", () => {
  const edge = new LineEdge({} as never, {});
  const olderEdge = { ...serialize(edge), graphLayout: undefined };
  const reload = (data: object) => deserialize(decode(encode(data)), {}) as LineEdge;
  expect(reload(olderEdge).graphLayout).toBeUndefined();
  expect(reload({ ...olderEdge, fishboneLayout: true }).graphLayout).toBe("fishbone");

  for (const layout of ["fishbone", "dag", "mindMap"] as const) {
    edge.graphLayout = layout;
    expect(reload(serialize(edge)).graphLayout).toBe(layout);
  }
});
