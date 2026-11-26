import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { describe, expect, it } from "vitest";
import { computeAdvancedGraphLayout } from "./advancedGraphLayouts";

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

describe("advanced graph layouts", () => {
  it.each(["tidyTree", "radialTree", "layered"] as const)(
    "places differently sized nodes without overlap in %s",
    async (mode) => {
      const positions = (await computeAdvancedGraphLayout(mode, rectangles, treeEdges))!;
      expect(positions.size).toBe(rectangles.size);
      const placed = [...positions].map(([id, location]) => new Rectangle(location, rectangles.get(id)!.size));
      for (const [index, rectangle] of placed.entries()) {
        for (const other of placed.slice(0, index)) expect(rectangle.isCollideWithRectangle(other)).toBe(false);
      }
      if (mode === "tidyTree" || mode === "radialTree") {
        expect(positions.get("root")).toEqual(rectangles.get("root")!.location);
      }
      expect(await computeAdvancedGraphLayout(mode, rectangles, treeEdges)).toEqual(positions);
    },
  );

  it("puts each tier on a separate radial ring", async () => {
    const positions = (await computeAdvancedGraphLayout("radialTree", rectangles, treeEdges))!;
    const center = (id: string) => new Rectangle(positions.get(id)!, rectangles.get(id)!.size).center;
    const root = center("root");
    expect(root.distance(center("short"))).toBeCloseTo(root.distance(center("tall")));
    expect(root.distance(center("leaf"))).toBeGreaterThan(root.distance(center("tall")));
  });

  it("preserves direction across forks and joins in a layered graph", async () => {
    const edges = [...treeEdges, { source: "tall", target: "leaf" }];
    const positions = (await computeAdvancedGraphLayout("layered", rectangles, edges))!;
    for (const { source, target } of edges) {
      expect(positions.get(target)!.x).toBeGreaterThan(positions.get(source)!.x + rectangles.get(source)!.width);
    }
  });

  it.each(["tidyTree", "radialTree"] as const)(
    "rejects shared children and disconnected cycles in %s",
    async (mode) => {
      const sharedChild = [...treeEdges, { source: "tall", target: "leaf" }];
      const cycle = [
        { source: "root", target: "short" },
        { source: "tall", target: "leaf" },
        { source: "leaf", target: "tall" },
      ];
      await expect(computeAdvancedGraphLayout(mode, rectangles, sharedChild)).resolves.toBeUndefined();
      await expect(computeAdvancedGraphLayout(mode, rectangles, cycle)).resolves.toBeUndefined();
    },
  );
});
