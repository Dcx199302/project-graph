import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { describe, expect, it } from "vitest";
import { computeTidyTreeLayout } from "./advancedGraphLayouts";

const rectangles = new Map([
  ["root", new Rectangle(new Vector(80, -100), new Vector(240, 80))],
  ["short", new Rectangle(new Vector(350, 0), new Vector(120, 60))],
  ["tall", new Rectangle(new Vector(350, 20), new Vector(270, 220))],
  ["leaf", new Rectangle(new Vector(20, 20), new Vector(210, 100))],
]);
const treeEdges = [
  { source: "root", target: "short" },
  { source: "root", target: "tall" },
  { source: "short", target: "leaf" },
];

describe("tidy tree layout", () => {
  it("places differently sized nodes without overlap and keeps the root in place", () => {
    const positions = computeTidyTreeLayout(rectangles, treeEdges)!;
    expect(positions.size).toBe(rectangles.size);
    const placed = [...positions].map(([id, location]) => new Rectangle(location, rectangles.get(id)!.size));
    for (const [index, rectangle] of placed.entries()) {
      for (const other of placed.slice(0, index)) expect(rectangle.isCollideWithRectangle(other)).toBe(false);
    }
    expect(positions.get("root")).toEqual(rectangles.get("root")!.location);
    for (const { source, target } of treeEdges) {
      expect(positions.get(target)!.x - positions.get(source)!.x - rectangles.get(source)!.width).toBe(150);
    }
    expect(computeTidyTreeLayout(rectangles, treeEdges)).toEqual(positions);
  });

  it("rejects shared children and disconnected cycles", () => {
    const sharedChild = [...treeEdges, { source: "tall", target: "leaf" }];
    const cycle = [
      { source: "root", target: "short" },
      { source: "tall", target: "leaf" },
      { source: "leaf", target: "tall" },
    ];
    expect(computeTidyTreeLayout(rectangles, sharedChild)).toBeUndefined();
    expect(computeTidyTreeLayout(rectangles, cycle)).toBeUndefined();
  });
});
