// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/service/Settings", () => ({
  Settings: { isEnableEntityCollision: false, isEnableSectionCollision: false },
}));
vi.mock("@/core/Project", () => ({
  Project: class Project {},
  service: () => (target: unknown) => target,
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 24 } }));
vi.mock("@/core/stage/stageObject/association/EdgeCollisionBoxGetter", () => ({ EdgeCollisionBoxGetter: {} }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({ TextNode: class {} }));
vi.mock("@/utils/font", () => ({ getMultiLineTextSize: () => new Vector(20, 20) }));

import type { Project } from "@/core/Project";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Vector } from "@graphif/data-structures";
import { Rectangle, SymmetryCurve } from "@graphif/shapes";
import { AutoLayout } from "./mainTick";

function createEntity(uuid: string, x: number, y: number, width: number, height: number): ConnectableEntity {
  return {
    uuid,
    collisionBox: new CollisionBox([new Rectangle(new Vector(x, y), new Vector(width, height))]),
    moveTo: vi.fn(),
  } as unknown as ConnectableEntity;
}

function createEdge(
  source: ConnectableEntity,
  target: ConnectableEntity,
  sourceX = 0.5,
  targetX = 0.5,
  sourceY = 0.5,
  targetY = 0.5,
) {
  return {
    source,
    target,
    lineType: "solid",
    sourceRectangleRate: new Vector(sourceX, sourceY),
    targetRectangleRate: new Vector(targetX, targetY),
  };
}

function createMindMapProject(edges: ReturnType<typeof createEdge>[]) {
  return {
    stageManager: {
      getLineEdges: () => edges,
      getEdges: () => edges,
      getSections: () => [],
      getTopLevelEntities: () => [],
      getConnectableEntity: () => edges.flatMap(({ source, target }) => [source, target]),
    },
    sectionMoveDepth: 0,
    historyManager: { recordStep: vi.fn() },
  } as unknown as Project;
}

describe("AutoLayout.autoLayoutDAG", () => {
  it("returns a layout summary and keeps the first root as the layout anchor", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const child = createEntity("child", 0, 0, 160, 50);
    const grandchild = createEntity("grandchild", 0, 0, 80, 50);
    const children = new Map<ConnectableEntity, ConnectableEntity[]>([
      [root, [child]],
      [child, [grandchild]],
      [grandchild, []],
    ]);
    const recordStep = vi.fn();
    const project = {
      stageManager: { getEdges: () => [createEdge(root, child), createEdge(child, grandchild)] },
      graphMethods: {
        nodeChildrenArray: (entity: ConnectableEntity) => children.get(entity) ?? [],
      },
      historyManager: { recordStep },
    } as unknown as Project;

    const result = new AutoLayout(project).autoLayoutDAG([root, child, grandchild]);

    expect(result).toEqual({ movedCount: 3, internalEdgeCount: 2 });
    expect(recordStep).toHaveBeenCalledOnce();
    expect((root.moveTo as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ x: 10, y: 20 });
    expect((child.moveTo as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ x: 260, y: 20 });
    expect((grandchild.moveTo as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ x: 570, y: 20 });
  });
});

describe("AutoLayout.autoLayoutMindMap", () => {
  it.each(["horizontal", "vertical"] as const)(
    "uses the base level spacing while keeping the %s tree root fixed",
    (axis) => {
      const horizontal = axis === "horizontal";
      const root = createEntity("root", 0, 0, 100, 50);
      const child = createEntity("child", horizontal ? 400 : 0, horizontal ? 0 : 400, 100, 50);
      const leaf = createEntity("leaf", horizontal ? 800 : 0, horizontal ? 0 : 800, 100, 50);
      for (const node of [child, leaf]) {
        vi.mocked(node.moveTo).mockImplementation((location) => {
          (node.collisionBox.shapes[0] as Rectangle).location = location;
        });
      }
      const project = createMindMapProject([createEdge(root, child), createEdge(child, leaf)]);
      const layout = new AutoLayout(project);
      layout.autoLayoutGraph([root, child, leaf], "mindMap");

      const center = (node: ConnectableEntity) => node.collisionBox.getRectangle().center;
      const distance = horizontal ? 415 : 305;
      expect(center(root).distance(center(child))).toBeCloseTo(distance);
      expect(center(child).distance(center(leaf))).toBeCloseTo(distance);
      expect(root.moveTo).not.toHaveBeenCalled();
      layout.autoLayoutGraph([root, child, leaf], "mindMap");
      expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
    },
  );

  it("fixes a single selected node in place and lays out only its direct neighbors", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const left = createEntity("left", -200, 10, 80, 50);
    const right = createEntity("right", 300, 100, 120, 50);
    const indirect = createEntity("indirect", 100, 80, 80, 50);
    const locked = createEntity("locked", 400, 160, 80, 50);
    Object.defineProperty(locked, "nearestLockedAncestorSection", { value: {} });
    const project = createMindMapProject([
      createEdge(left, root),
      createEdge(root, right),
      createEdge(right, root),
      createEdge(left, right),
      createEdge(right, indirect),
      createEdge(root, locked),
    ]);

    expect(new AutoLayout(project).autoLayoutMindMap([root])).toBe(true);
    expect(root.moveTo).not.toHaveBeenCalled();
    expect(left.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-385, 20));
    expect(right.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, 20));
    expect(indirect.moveTo).not.toHaveBeenCalled();
    expect(locked.moveTo).not.toHaveBeenCalled();
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
  });

  it("skips layout and history if a single selected node has no neighbor", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const project = createMindMapProject([createEdge(root, root)]);

    expect(new AutoLayout(project).autoLayoutMindMap([root])).toBe(true);
    expect(root.moveTo).not.toHaveBeenCalled();
    expect(project.historyManager.recordStep).not.toHaveBeenCalled();
  });

  it("keeps the root and manually fixed port direction while laying out only selected branches", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const upper = createEntity("upper", 0, 0, 160, 70);
    const lower = createEntity("lower", 0, 500, 80, 50);
    const leaf = createEntity("leaf", 0, 100, 80, 50);
    const unselected = createEntity("unselected", 0, 200, 80, 50);
    const project = createMindMapProject([]);
    const fixedEdge = new LineEdge(project, {
      associationList: [root, lower],
      sourceRectangleRate: new Vector(0.99, 0.5),
      targetRectangleRate: new Vector(0.01, 0.5),
      fixedEndpoints: true,
    });
    vi.spyOn(project.stageManager, "getEdges").mockReturnValue([
      fixedEdge,
      new LineEdge(project, { associationList: [root, upper] }),
      new LineEdge(project, { associationList: [upper, leaf] }),
      new LineEdge(project, { associationList: [upper, unselected] }),
    ]);

    expect(new AutoLayout(project).autoLayoutMindMap([lower, leaf, root, upper])).toBe(true);
    expect(root.moveTo).not.toHaveBeenCalled();
    expect(upper.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-20, 325));
    expect(lower.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, 20));
    expect(leaf.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(20, 650));
    expect(unselected.moveTo).not.toHaveBeenCalled();
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
    expect(project.sectionMoveDepth).toBe(0);
  });

  it.each([
    ["right", 1, 0, 415, 0],
    ["left", -1, 0, -415, 0],
    ["down", 0, 1, 0, 305],
    ["up", 0, -1, 0, -305],
  ] as const)(
    "grows %s based on the whole tree even when its first branch starts on the opposite side",
    (_, dx, dy, x, y) => {
      const root = createEntity("root", 0, 0, 100, 50);
      const branch = createEntity("branch", -160 * dx, -160 * dy, 100, 50);
      const first = createEntity("first", 600 * dx - 60 * dy, 600 * dy - 60 * dx, 100, 50);
      const second = createEntity("second", 600 * dx + 60 * dy, 600 * dy + 60 * dx, 100, 50);
      const project = createMindMapProject([
        createEdge(root, branch),
        createEdge(branch, first),
        createEdge(branch, second),
      ]);

      expect(new AutoLayout(project).autoLayoutMindMap([branch, first, second, root])).toBe(true);
      expect(root.moveTo).not.toHaveBeenCalled();
      expect(branch.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(x, y));
    },
  );

  it.each([
    ["top", new Vector(300, -180), new Vector(300, 125), new Vector(300, 430)],
    ["bottom", new Vector(300, 200), new Vector(300, -105), new Vector(300, -410)],
    ["right", new Vector(1500, 0), new Vector(1085, 0), new Vector(670, 0)],
    ["left", new Vector(0, 0), new Vector(415, 0), new Vector(830, 0)],
  ] as const)(
    "follows a root dragged to the %s side of a tree with automatic right-facing ports",
    (_, rootPosition, branchPosition, leafPosition) => {
      const root = createEntity("root", 0, 0, 100, 50);
      const branch = createEntity("branch", 240, 0, 100, 50);
      const leaf = createEntity("leaf", 1200, 0, 100, 50);
      const project = createMindMapProject([]);
      const connect = (source: ConnectableEntity, target: ConnectableEntity) =>
        new LineEdge(project, {
          associationList: [source, target],
          sourceRectangleRate: new Vector(0.99, 0.5),
          targetRectangleRate: new Vector(0.01, 0.5),
        });
      vi.spyOn(project.stageManager, "getEdges").mockReturnValue([connect(root, branch), connect(branch, leaf)]);
      (root.collisionBox.shapes[0] as Rectangle).location = rootPosition;

      expect(new AutoLayout(project).autoLayoutGraph([leaf, root, branch], "mindMap")).toBe(true);
      expect(root.moveTo).not.toHaveBeenCalled();
      expect(branch.moveTo).toHaveBeenCalledExactlyOnceWith(branchPosition);
      expect(leaf.moveTo).toHaveBeenCalledExactlyOnceWith(leafPosition);
    },
  );

  it.each([-1, 1])("enters both nearby diagonal leaves vertically when growing in direction %s", (sign) => {
    const root = createEntity("root", 0, 0, 80, 50);
    const leaves = [createEntity("left", -80, sign * 400, 80, 50), createEntity("right", 80, sign * 400, 80, 50)];
    for (const node of [root, ...leaves]) {
      Object.defineProperty(node, "clipConnectionToBoundary", { value: true });
      vi.mocked(node.moveTo).mockImplementation((location) => {
        (node.collisionBox.shapes[0] as Rectangle).location = location;
      });
    }
    const project = createMindMapProject([]);
    const edges = leaves.map((leaf) => new LineEdge(project, { associationList: [root, leaf] }));
    vi.spyOn(project.stageManager, "getEdges").mockReturnValue(edges);
    const layout = new AutoLayout(project);

    expect(layout.formatMindMap([root, ...leaves])).toBe(true);
    for (const edge of edges) {
      const target = edge.target.collisionBox.getRectangle();
      expect(edge.bodyLine.end).toEqual(sign > 0 ? target.topCenter : target.bottomCenter);
      expect(edge.targetRectangleRate).toEqual(new Vector(0.5, sign > 0 ? 0.01 : 0.99));
    }
  });

  it.each([false, true])("places incoming branches left of the hub (two sources: %s)", (twoSources) => {
    const hub = createEntity("a", 10, 20, 100, 50);
    const first = createEntity("b", 0, 0, 160, 50);
    const second = createEntity("c", 0, 30, 80, 50);
    const incoming = createEntity("e", 0, 0, 80, 50);
    const anotherIncoming = createEntity("f", 0, 30, 120, 50);
    const project = createMindMapProject([
      createEdge(hub, first),
      createEdge(hub, second),
      createEdge(incoming, hub),
      createEdge(anotherIncoming, hub),
    ]);
    const selected = [incoming, first, second, hub];
    if (twoSources) selected.push(anotherIncoming);

    expect(new AutoLayout(project).autoLayoutMindMap(selected)).toBe(true);
    expect(hub.moveTo).not.toHaveBeenCalled();
    expect(incoming.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-385, twoSources ? -36 : 20));
    if (twoSources) {
      expect(anotherIncoming.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-425, 76));
    } else {
      expect(anotherIncoming.moveTo).not.toHaveBeenCalled();
    }
    expect(first.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, -36));
    expect(second.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, 76));
  });

  it("automatically arranges all four sides, using vertical ports and existing positions", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const left = createEntity("left", -250, 30, 80, 50);
    const right = createEntity("right", 300, 25, 80, 50);
    const aboveLeft = createEntity("aboveLeft", -250, 200, 80, 50);
    const aboveRight = createEntity("aboveRight", 250, 200, 80, 50);
    const below = createEntity("below", 30, 300, 80, 50);
    const project = createMindMapProject([
      createEdge(root, left),
      createEdge(right, root),
      createEdge(root, aboveRight, 0.5, 0.5, 0.01, 0.99),
      createEdge(aboveLeft, root, 0.5, 0.5, 0.99, 0.01),
      createEdge(below, root),
    ]);

    expect(new AutoLayout(project).autoLayoutMindMap([root])).toBe(true);
    expect(root.moveTo).not.toHaveBeenCalled();
    expect(left.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-385, 20));
    expect(right.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, 20));
    expect(aboveLeft.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-51, -285));
    expect(aboveRight.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(91, -285));
    expect(below.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(20, 325));
  });

  it("keeps vertical levels aligned and clears overlaps with perpendicular branches", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const above = createEntity("above", -250, -450, 600, 50);
    const right = createEntity("right", 250, -200, 100, 400);
    const leaf = createEntity("leaf", 10, -550, 80, 50);
    const project = createMindMapProject([
      createEdge(root, above),
      createEdge(root, right, 0.99, 0.01),
      createEdge(above, leaf),
    ]);

    expect(new AutoLayout(project).autoLayoutMindMap([above, leaf, right, root])).toBe(true);
    expect(right.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, -155));
    expect(above.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-240, -285));
    expect(leaf.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(20, -590));
  });

  it("keeps outer siblings in their direction on repeated automatic layout", () => {
    const root = createEntity("root", 10, 20, 100, 50);
    const siblings = Array.from({ length: 7 }, (_, index) => createEntity(String(index), 600, index * 40, 80, 80));
    for (const node of siblings) {
      vi.mocked(node.moveTo).mockImplementation((location) => {
        (node.collisionBox.shapes[0] as Rectangle).location = location;
      });
    }
    const layout = new AutoLayout(createMindMapProject(siblings.map((node) => createEdge(root, node))));
    expect(layout.autoLayoutMindMap([root])).toBe(true);
    const positions = siblings.map((node) => node.collisionBox.getRectangle().location);
    expect(layout.autoLayoutMindMap([root])).toBe(true);
    expect(siblings.map((node) => node.collisionBox.getRectangle().location)).toEqual(positions);
  });

  it.each([
    [-1, 9],
    [1, 9],
    [-1, 10],
    [1, 10],
  ])("gives the vertical tree a central branch and staggered sides (direction %s, %s children)", (sign, count) => {
    const root = createEntity("root", 0, 0, 100, 50);
    const middle = Math.floor(count / 2);
    const siblings = Array.from({ length: count }, (_, index) =>
      createEntity(String(index), (index - middle) * 220, sign * 300, 160 + index * 7, 50),
    );
    const leaves = [
      createEntity("inner leaf", 0, sign * 600, 120, 50),
      createEntity("outer leaf", 150, sign * 600, 120, 50),
    ];
    const sideParent = siblings[count - 2];
    const tip = createEntity("leaf tip", 5, sign * 900, 80, 50);
    const nodes = [root, ...siblings, ...leaves, ...(count === 10 ? [tip] : [])];
    for (const node of nodes) {
      Object.defineProperty(node, "clipConnectionToBoundary", { value: true });
      vi.mocked(node.moveTo).mockImplementation((location) => {
        (node.collisionBox.shapes[0] as Rectangle).location = location;
      });
    }
    const project = createMindMapProject([]);
    const fanEdges = siblings.map((node) => new LineEdge(project, { associationList: [root, node] }));
    vi.spyOn(project.stageManager, "getEdges").mockReturnValue([
      ...fanEdges,
      ...leaves.map((leaf) => new LineEdge(project, { associationList: [sideParent, leaf] })),
      ...(count === 10 ? [new LineEdge(project, { associationList: [leaves[0], tip] })] : []),
    ]);
    const layout = new AutoLayout(project);
    const rect = (node: ConnectableEntity) => node.collisionBox.getRectangle();
    const gap = (parent: ConnectableEntity, child: ConnectableEntity) =>
      sign > 0 ? rect(child).top - rect(parent).bottom : rect(parent).top - rect(child).bottom;

    expect(layout.autoLayoutMindMap(nodes)).toBe(true);
    expect(root.moveTo).not.toHaveBeenCalled();
    const depths = siblings.map((node) => gap(root, node));
    const left = depths.slice(0, middle);
    const right = depths.slice(middle + 1).reverse();
    expect(left).toEqual([...left].sort((a, b) => a - b));
    expect(right).toEqual([...right].sort((a, b) => a - b));
    expect(left[0]).toBe(255);
    expect(right[0]).toBeGreaterThan(left[0]);
    expect(left[2] - left[1]).toBeLessThan(right[2] - right[1]);
    expect(depths[middle]).toBeGreaterThan(Math.max(...left, ...right));
    expect(rect(siblings[middle]).center.x).toBe(rect(root).center.x);
    expect(rect(sideParent).left - rect(siblings[count - 1]).left).toBeGreaterThan(200);
    const leftGaps = left.slice(1).map((depth, index) => depth - left[index]);
    expect(Math.max(...leftGaps) - Math.min(...leftGaps)).toBeGreaterThan(32);
    expect(leaves.map((leaf) => gap(sideParent, leaf))).toEqual([255, 255]);
    const rowWidth = siblings.reduce((width, node) => width + rect(node).width, 0) + (count - 1) * 62;
    expect(Rectangle.getBoundingRectangle(siblings.map(rect)).width).toBeLessThan(rowWidth * 0.65);
    for (const [index, edge] of fanEdges.entries()) {
      const { start, end } = edge.bodyLine;
      const child = rect(siblings[index]);
      expect(start).toEqual(sign > 0 ? rect(root).bottomCenter : rect(root).topCenter);
      const inward = sign > 0 ? child.topCenter : child.bottomCenter;
      const side = index < middle ? child.rightCenter : child.leftCenter;
      expect(index === middle ? [inward] : [inward, side]).toContainEqual(end);
      const curve = new SymmetryCurve(
        start,
        Edge.getNormalVectorByRate(edge.sourceRectangleRate)!,
        end,
        Edge.getNormalVectorByRate(edge.targetRectangleRate)!,
      );
      expect(
        nodes.some((node) => node !== root && node !== edge.target && curve.isCollideWithRectangle(rect(node))),
      ).toBe(false);
    }
    const positions = nodes.map((node) => rect(node).location);
    expect(layout.autoLayoutMindMap(nodes)).toBe(true);
    expect(nodes.map((node) => rect(node).location)).toEqual(positions);
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
  });

  it.each(["position", "ports"])("keeps incoming framework nodes on the right based on their %s", (basis) => {
    const server = createEntity("server", 10, 20, 100, 50);
    const x = basis === "ports" ? -250 : 250;
    const frameworks = [
      createEntity("nest", x, 0, 160, 50),
      createEntity("koa", x, 80, 80, 50),
      createEntity("hono", x, 220, 120, 50),
    ];
    const edges = frameworks.map((node) =>
      basis === "ports" ? createEdge(node, server, 0.01, 0.99) : createEdge(node, server),
    );
    const project = createMindMapProject(edges);

    expect(new AutoLayout(project).autoLayoutMindMap([...frameworks, server])).toBe(true);
    expect(server.moveTo).not.toHaveBeenCalled();
    for (const [index, node] of frameworks.entries()) {
      expect(node.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(425, -92 + index * 112));
      expect(edges[index].source).toBe(node);
      expect(edges[index].target).toBe(server);
    }
  });

  it("anchors a cyclic component at its best-connected node and places other components around it", () => {
    const isolated = createEntity("isolated", 200, 5, 100, 50);
    const hub = createEntity("hub", 0, 0, 100, 50);
    const first = createEntity("first", 300, 0, 100, 50);
    const second = createEntity("second", 300, 80, 100, 50);
    const third = createEntity("third", 300, 160, 100, 50);
    const otherRoot = createEntity("otherRoot", 210, 0, 100, 50);
    const otherChild = createEntity("otherChild", 330, 0, 100, 50);
    const reverseEdge = createEdge(second, hub);
    const project = createMindMapProject([
      createEdge(hub, first, 0.99, 0.01),
      createEdge(first, second),
      createEdge(hub, second, 0.99, 0.01),
      reverseEdge,
      createEdge(hub, third, 0.99, 0.01),
      createEdge(otherRoot, otherChild),
    ]);

    expect(
      new AutoLayout(project).autoLayoutMindMap([isolated, first, otherRoot, second, third, hub, otherChild]),
    ).toBe(true);
    expect(hub.moveTo).not.toHaveBeenCalled();
    expect(first.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(415, -112));
    expect(second.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(415, 0));
    expect(third.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(415, 112));
    expect(otherRoot.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(609, 0));
    expect(otherChild.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(1024, 0));
    expect(isolated.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-194, 5));
    expect(reverseEdge.source).toBe(second);
    expect(reverseEdge.target).toBe(hub);
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
  });

  it("uses the best-connected node when a branch has links in both directions", () => {
    const source = createEntity("source", -300, 50, 100, 50);
    const hub = createEntity("hub", 0, 0, 100, 50);
    const other = createEntity("other", -500, 50, 100, 50);
    const first = createEntity("first", 300, 0, 100, 50);
    const second = createEntity("second", 300, 80, 100, 50);
    const project = createMindMapProject([
      createEdge(source, hub),
      createEdge(source, other),
      createEdge(hub, first),
      createEdge(first, hub),
      createEdge(hub, second),
    ]);

    expect(new AutoLayout(project).autoLayoutMindMap([source, hub, other, first, second])).toBe(true);
    expect(hub.moveTo).not.toHaveBeenCalled();
    expect(source.moveTo).toHaveBeenCalledExactlyOnceWith(new Vector(-415, 0));
  });
});

describe("fishbone layout", () => {
  function trackMoves(nodes: ConnectableEntity[]) {
    for (const node of nodes) {
      vi.mocked(node.moveTo).mockImplementation((location) => {
        (node.collisionBox.shapes[0] as Rectangle).location = location;
      });
    }
  }

  it("preserves a directed spine, a back edge and the directions of incoming and outgoing ribs", () => {
    const start = createEntity("start", 500, 20, 120, 80);
    const step = createEntity("step", -200, 200, 160, 60);
    const head = createEntity("head", 160, 40, 80, 50);
    const upper = createEntity("upper", -100, 400, 130, 50);
    const lower = createEntity("lower", -100, -300, 300, 90);
    const detail = createEntity("detail", -500, 300, 210, 80);
    const nodes = [head, lower, step, upper, start, detail];
    const edges = [
      createEdge(start, step),
      createEdge(step, head),
      createEdge(upper, step),
      createEdge(lower, head),
      createEdge(upper, detail),
      createEdge(step, start),
    ];
    const project = createMindMapProject(edges);
    const layout = new AutoLayout(project);
    trackMoves(nodes);

    expect(layout.autoLayoutGraph(nodes, "fishbone")).toBe(true);
    const rectangles = nodes.map((node) => node.collisionBox.getRectangle());
    const [headRect, lowerRect, stepRect, upperRect, startRect, detailRect] = rectangles;
    expect(head.moveTo).not.toHaveBeenCalled();
    expect(startRect.right).toBeLessThan(stepRect.left);
    expect(stepRect.right).toBeLessThan(headRect.left);
    expect(startRect.center.y).toBe(headRect.center.y);
    expect(stepRect.center.y).toBe(headRect.center.y);
    expect(upperRect.top).toBeGreaterThan(stepRect.bottom);
    expect(detailRect.top).toBeGreaterThan(upperRect.bottom);
    expect(lowerRect.bottom).toBeLessThan(headRect.top);
    expect(upperRect.right).toBeLessThan(stepRect.left);
    expect(detailRect.left).toBeGreaterThan(upperRect.right);
    expect(lowerRect.right).toBeLessThan(headRect.left);
    for (const [index, rectangle] of rectangles.entries()) {
      expect(rectangles.slice(index + 1).some((other) => rectangle.isCollideWith(other))).toBe(false);
    }
    expect(edges[5]).toMatchObject({ source: step, target: start });

    expect(layout.autoLayoutGraph(nodes, "fishbone")).toBe(true);
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
  });

  it("alternates entire rib groups below, above and below even if every branch starts below the spine", () => {
    const root = createEntity("root", 0, 140, 260, 50);
    const jsx = createEntity("jsx", 500, 140, 80, 50);
    const component = createEntity("component", 800, 140, 160, 50);
    const props = createEntity("props", 1200, 140, 120, 50);
    const siblings = Array.from({ length: 6 }, (_, index) =>
      createEntity(`rib${index}`, -300 - index * 50, 250 + index * 75, 80 + index * 31, 35 + index * 6),
    );
    const taxonomy = createEntity("taxonomy", 600, 260, 120, 45);
    const state = createEntity("state", 1000, 250, 80, 50);
    const event = createEntity("ui-event", 1000, 320, 100, 50);
    const nodes = [root, jsx, component, props, ...siblings, taxonomy, state, event];
    for (const node of nodes) Object.defineProperty(node, "clipConnectionToBoundary", { value: true });
    const project = createMindMapProject([]);
    const connect = (from: ConnectableEntity, to: ConnectableEntity, sourceRectangleRate?: Vector) =>
      new LineEdge(project, { associationList: [from, to], sourceRectangleRate });
    const branchEdges = [
      ...siblings.map((node) => connect(root, node)),
      connect(jsx, taxonomy),
      connect(component, state),
      connect(component, event),
    ];
    const external = createEntity("unselected", 2000, 50, 100, 40);
    const externalEdge = connect(root, external);
    const customPort = new Vector(0.5, 0.01);
    const mainEdge = connect(jsx, component, customPort);
    vi.spyOn(project.stageManager, "getEdges").mockReturnValue([
      connect(root, jsx),
      mainEdge,
      connect(component, props),
      ...branchEdges,
      externalEdge,
    ]);
    const layout = new AutoLayout(project);
    trackMoves(nodes);

    expect(layout.autoLayoutGraph(nodes, "fishbone")).toBe(true);
    const rect = (node: ConnectableEntity) => node.collisionBox.getRectangle();
    expect(new Set(siblings.map((node) => rect(node).left)).size).toBe(1);
    for (const [index, box] of siblings.map(rect).entries()) {
      expect(box.top).toBeGreaterThan(rect(root).bottom);
      expect(box.right).toBeLessThan(rect(jsx).left);
      if (index > 0) expect(rect(siblings[index - 1]).bottom).toBeLessThan(box.top);
    }
    expect(rect(taxonomy).bottom).toBeLessThan(rect(jsx).top);
    expect(rect(state).top).toBeGreaterThan(rect(component).bottom);
    expect(rect(event).top).toBeGreaterThan(rect(state).bottom);
    expect(rect(state).left).toBe(rect(event).left);
    for (const edge of branchEdges) {
      expect(edge.graphLayout).toBe("fishbone");
      const { start, end } = edge.bodyLine;
      expect(start).toEqual(rect(edge.source).rightCenter);
      expect(end).toEqual(rect(edge.target).leftCenter);
      const startDirection = Edge.getNormalVectorByRate(edge.sourceRectangleRate)!;
      const endDirection = Edge.getNormalVectorByRate(edge.targetRectangleRate)!;
      const { ctrlPt1, ctrlPt2 } = new SymmetryCurve(start, startDirection, end, endDirection).bezier;
      expect(ctrlPt1.x).toBeGreaterThan(start.x);
      expect(ctrlPt1.x).toBeLessThanOrEqual(ctrlPt2.x);
      expect(ctrlPt2.x).toBeLessThan(end.x);
    }
    expect(mainEdge.sourceRectangleRate).toEqual(customPort);
    expect(externalEdge.graphLayout).toBeUndefined();
    expect(externalEdge.sourceRectangleRate).toEqual(Vector.same(0.5));
    expect(external.moveTo).not.toHaveBeenCalled();
    expect(layout.autoLayoutGraph(nodes, "fishbone")).toBe(true);
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
  });
});
