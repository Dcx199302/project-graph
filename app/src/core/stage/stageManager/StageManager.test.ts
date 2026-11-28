import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

vi.mock("@/core/Project", () => ({
  Project: class Project {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: (id: string) => (target: { id?: string }) => {
    target.id = id;
    return target;
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({
  Renderer: { FONT_SIZE: 24, NODE_PADDING: 10 },
}));
vi.mock("@/core/service/Settings", () => ({ Settings: { watch: vi.fn(), historySize: 100 } }));
vi.mock("@/core/service/Telemetry", () => ({ Telemetry: {} }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { play: { associationAdjustSoundFile: vi.fn(), treeGenerateDeepSoundFile: vi.fn() } },
}));
vi.mock("@/core/stage/stageObject/entity/ReferenceBlockNode", () => ({ ReferenceBlockNode: class {} }));
vi.mock("@/utils/font", () => ({
  getMultiLineTextSize: (text: string) => new Vector(Math.max(20, text.length * 10), text.split("\n").length * 20),
  getTextSize: () => new Vector(20, 20),
}));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import { StageManager } from "./StageManager";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { PenStroke } from "@/core/stage/stageObject/entity/PenStroke";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import type { Project } from "@/core/Project";
import { LayoutManager } from "./concreteMethods/LayoutManager";
import { NodeAdder } from "./concreteMethods/StageNodeAdder";
import { DeleteManager } from "./concreteMethods/StageDeleteManager";
import { EntityMoveManager } from "./concreteMethods/StageEntityMoveManager";
import { SectionInOutManager } from "./concreteMethods/StageSectionInOutManager";
import { SectionPackManager } from "./concreteMethods/StageSectionPackManager";
import { Direction } from "@/types/directions";
import { HistoryManager } from "./StageHistoryManager";
import { NodeConnector } from "./concreteMethods/StageNodeConnector";
import { SectionMethods } from "./basicMethods/SectionMethods";
import { GraphMethods } from "./basicMethods/GraphMethods";
import { ConnectNodeSmartTools } from "@/core/service/dataManageService/connectNodeSmartTools";
import { ArcEdge } from "@/core/stage/stageObject/association/ArcEdge";
import { Settings } from "@/core/service/Settings";
import { SectionCollisionSolver } from "./concreteMethods/SectionCollisionSolver";
import { AutoLayoutFastTree } from "@/core/service/controlService/autoLayoutEngine/autoLayoutFastTreeMode";
import { AutoLayout } from "@/core/service/controlService/autoLayoutEngine/mainTick";
import { KeyboardOnlyTreeEngine } from "@/core/service/controlService/keyboardOnlyEngine/keyboardOnlyTreeEngine";
import { AutoAlign } from "./concreteMethods/StageAutoAlignManager";
import { EntityRenderer } from "@/core/render/canvas2d/entityRenderer/EntityRenderer";
import { TreeImporter } from "@/core/service/dataGenerateService/stageImportEngine/TreeImporter";

function createStageManager(stage: object[]) {
  return new StageManager({ stage } as never);
}

function textNode(uuid: string, x = 0, y = 0): TextNode {
  return Object.assign(Object.create(TextNode.prototype), {
    uuid,
    collisionBox: new CollisionBox([new Rectangle(new Vector(x, y), new Vector(100, 80))]),
    unknown: false,
  }) as TextNode;
}

/** 反序列化过程中尚未加载的占位节点：uuid 已知、unknown 为 true */
function unknownEntity(uuid: string): TextNode {
  return Object.assign(Object.create(TextNode.prototype), {
    uuid,
    collisionBox: new CollisionBox([new Rectangle(new Vector(0, 0), new Vector(100, 80))]),
    unknown: true,
  }) as TextNode;
}

function section(uuid: string, children: Entity[]): Section {
  const collisionBox = new CollisionBox([new Rectangle(new Vector(0, 0), new Vector(300, 200))]);
  return Object.assign(Object.create(Section.prototype), {
    uuid,
    text: "",
    children,
    isCollapsed: false,
    locked: false,
    unknown: false,
    // Section.collisionBox 是 getter，读取这两个内部字段
    _collisionBoxNormal: collisionBox,
    _collisionBoxWhenCollapsed: collisionBox,
    adjustLocationAndSize: () => {},
    adjustChildrenStateByCollapse: () => {},
  }) as Section;
}

function lineEdge(associationList: ConnectableEntity[], uuid = crypto.randomUUID()): LineEdge {
  return new LineEdge({} as never, { associationList, uuid });
}

describe("StageManager.selectAll", () => {
  it("selects downstream nodes first, then the connected components without unrelated nodes", () => {
    const a = textNode("a");
    const b = textNode("b");
    const c = textNode("c");
    const d = textNode("d");
    const e = textNode("e");
    const f = textNode("f");
    const upstream = textNode("upstream");
    const sibling = textNode("sibling");
    const isolated = textNode("isolated");
    const manager = createStageManager([
      a,
      b,
      c,
      d,
      e,
      f,
      upstream,
      sibling,
      isolated,
      lineEdge([upstream, b]),
      lineEdge([b, a]),
      lineEdge([b, sibling]),
      lineEdge([a, c]),
      lineEdge([c, d]),
      lineEdge([c, a]),
      new MultiTargetUndirectedEdge({} as Project, { associationList: [f, e] }),
    ]);
    a.isSelected = e.isSelected = true;

    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([a, c, d, e, f]);
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([a, b, c, d, e, f, upstream, sibling]);
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([a, b, c, d, e, f, upstream, sibling]);
  });

  it("starts a new sequence when the selection changes or is cleared", () => {
    const a = textNode("a");
    const b = textNode("b");
    const c = textNode("c");
    const d = textNode("d");
    const manager = createStageManager([a, b, c, d, lineEdge([a, b]), lineEdge([c, d])]);
    a.isSelected = true;
    expect(manager.selectAll()).toBe("local");

    a.isSelected = b.isSelected = false;
    c.isSelected = true;
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([c, d]);

    manager.clearSelectAll();
    expect(manager.getSelectedStageObjects()).toEqual([]);
    expect(manager.selectAll()).toBe("global");
    expect(manager.getStageObjects().every((object) => object.isSelected)).toBe(true);
    expect(manager.selectAll()).toBe("global");
  });

  it("keeps the starting node selected on the first press when there are no downstream nodes", () => {
    const isolated = textNode("isolated");
    const unrelated = textNode("unrelated");
    const loop = lineEdge([isolated, isolated]);
    const manager = createStageManager([isolated, unrelated, loop]);
    isolated.isSelected = true;

    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([isolated]);
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([isolated]);
  });

  it("keeps an edge-only selection local and selects the entire canvas after clearing it", () => {
    const source = textNode("source");
    const target = textNode("target");
    const edge = lineEdge([source, target]);
    const manager = createStageManager([source, target, edge]);
    edge.isSelected = true;

    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([edge]);
    manager.clearSelectAll();
    expect(manager.selectAll()).toBe("global");
    expect(manager.getSelectedStageObjects()).toEqual([source, target, edge]);
  });

  it("selects nested section contents and internal connections without selecting the outer section", () => {
    const project = createProjectWithHistory();
    const directChild = textNode("direct");
    const nestedChild = textNode("nested");
    const outside = textNode("outside");
    const nested = section("nested-section", [nestedChild]);
    const outer = section("outer", [directChild, nested]);
    const internal = lineEdge([directChild, nestedChild]);
    const internalUndirected = new MultiTargetUndirectedEdge(project, { associationList: [directChild, nestedChild] });
    const external = lineEdge([nestedChild, outside]);
    const spanning = new MultiTargetUndirectedEdge(project, { associationList: [directChild, nestedChild, outside] });
    project.stage.push(
      outer,
      directChild,
      nested,
      nestedChild,
      outside,
      internal,
      internalUndirected,
      external,
      spanning,
    );
    outer.isSelected = true;
    nested.isCollapsed = nestedChild.isHiddenBySectionCollapse = true;
    const manager = project.stageManager;

    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([directChild, nested, nestedChild, internal, internalUndirected]);
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([directChild, nested, nestedChild, internal, internalUndirected]);
  });

  it("keeps an empty section selected without expanding to the entire canvas", () => {
    const project = createProjectWithHistory();
    const empty = section("empty", []);
    project.stage.push(empty, textNode("outside"));
    empty.isSelected = true;

    expect(project.stageManager.selectAll()).toBe("local");
    expect(project.stageManager.getSelectedStageObjects()).toEqual([empty]);
  });
});

it("summarizes the selected object types and excludes background images", () => {
  const text = textNode("text");
  const group = section("group", []);
  const edge = lineEdge([text, group]);
  const background = Object.assign(Object.create(ImageNode.prototype), { isBackground: true, isSelected: true });
  const manager = createStageManager([text, group, edge, background]);

  expect(manager.getSelectionSummary()).toBe("0:0:0:0:0");
  text.isSelected = true;
  edge.isSelected = true;
  expect(manager.getSelectionSummary()).toBe("1:1:1:0:1");
  text.isSelected = false;
  group.isSelected = true;
  expect(manager.getSelectionSummary()).toBe("1:1:0:1:1");
});

it.each(["horizontal", "vertical"] as const)("arranges nodes on the %s axis around the first selected node", (axis) => {
  const vertical = axis === "vertical";
  const anchor = textNode("anchor", 100, 100);
  const before = textNode("before", vertical ? 240 : -200, vertical ? -200 : 240);
  const after = textNode("after", 480, 360);
  const untouched = textNode("untouched", 40, 40);
  (before.collisionBox.shapes[0] as Rectangle).size = new Vector(60, 40);
  (after.collisionBox.shapes[0] as Rectangle).size = new Vector(130, 120);
  const project = {
    stage: [before, after, untouched, anchor],
    sectionMoveDepth: 0,
    historyManager: { recordStep: vi.fn() },
  } as unknown as Project;
  for (const node of [before, after, untouched, anchor]) Object.assign(node, { project });
  project.stageManager = new StageManager(project);
  const layout = new LayoutManager(project);
  anchor.isSelected = true;
  expect(layout.canArrangeSelectedLine()).toBe(false);
  before.isSelected = true;
  after.isSelected = true;
  anchor.isSelected = true;
  expect(layout.canArrangeSelectedLine()).toBe(true);

  layout.arrangeSelectedLine(axis);

  expect(anchor.rectangle.location).toEqual(new Vector(100, 100));
  expect(before.rectangle.location).toEqual(vertical ? new Vector(120, 40) : new Vector(20, 120));
  expect(after.rectangle.location).toEqual(vertical ? new Vector(85, 200) : new Vector(220, 80));
  expect(untouched.rectangle.location).toEqual(new Vector(40, 40));
  layout.arrangeSelectedLine(axis);
  expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
});

it("toggles line arrangement from horizontal to vertical and restarts after reselecting nodes", () => {
  const project = createProjectWithHistory();
  project.historyManager = { recordStep: vi.fn() } as unknown as Project["historyManager"];
  const anchor = Object.assign(textNode("anchor", 100, 100), { project, isSelected: true });
  const node = Object.assign(textNode("other", 400, 300), { project, isSelected: true });
  project.stage.push(node, anchor);
  const layout = new LayoutManager(project);

  layout.toggleSelectedLineArrangement();
  expect(node.rectangle.location).toEqual(new Vector(272, 100));
  layout.toggleSelectedLineArrangement();
  expect(node.rectangle.location).toEqual(new Vector(100, 252));
  layout.toggleSelectedLineArrangement();
  expect(node.rectangle.location).toEqual(new Vector(272, 100));

  project.stageManager.clearSelectAll();
  anchor.isSelected = node.isSelected = true;
  layout.toggleSelectedLineArrangement();
  expect(node.rectangle.location).toEqual(new Vector(272, 100));
  expect(anchor.rectangle.location).toEqual(new Vector(100, 100));
  expect(project.historyManager.recordStep).toHaveBeenCalledTimes(3);
});

it.each(["edge", "undirected edge", "different parents"] as const)(
  "skips the whole line arrangement selection with %s",
  (blocker) => {
    const project = createProjectWithHistory();
    project.historyManager = { recordStep: vi.fn() } as unknown as Project["historyManager"];
    const first = Object.assign(textNode("first", 100, 100), { project, isSelected: true });
    const second = Object.assign(textNode("second", 400, 300), { project, isSelected: true });
    const outside = textNode("outside");
    project.stage.push(first, second, outside);
    if (blocker === "edge") project.stage.push(lineEdge([outside, first]));
    if (blocker === "undirected edge") {
      project.stage.push(new MultiTargetUndirectedEdge(project, { associationList: [outside, second] }));
    }
    if (blocker === "different parents") {
      first.parentSection = section("first-parent", [first]);
      second.parentSection = section("second-parent", [second]);
      project.stage.push(first.parentSection, second.parentSection);
    }

    new LayoutManager(project).toggleSelectedLineArrangement();

    expect(first.rectangle.location).toEqual(new Vector(100, 100));
    expect(second.rectangle.location).toEqual(new Vector(400, 300));
    expect(project.historyManager.recordStep).not.toHaveBeenCalled();
  },
);

it("arranges sibling groups together and carries their contents with them", () => {
  const project = createProjectWithHistory();
  project.historyManager = { recordStep: vi.fn() } as unknown as Project["historyManager"];
  const firstChild = Object.assign(textNode("first-child", 100, 100), { project });
  const secondChild = Object.assign(textNode("second-child", 400, 300), { project });
  const first = new Section(project, { text: "First", children: [firstChild] });
  const second = new Section(project, { text: "Second", children: [secondChild] });
  const parent = new Section(project, { text: "Parent", children: [first, second] });
  project.stage.push(parent, first, second, firstChild, secondChild);
  project.stageManager.updateReferences();
  first.isSelected = second.isSelected = true;
  const offset = secondChild.rectangle.location.subtract(second.rectangle.location);
  const layout = new LayoutManager(project);

  layout.toggleSelectedLineArrangement();
  expect(second.rectangle.center.y).toBe(first.rectangle.center.y);
  expect(second.rectangle.left - first.rectangle.right).toBe(72);
  layout.toggleSelectedLineArrangement();
  expect(second.rectangle.center.x).toBe(first.rectangle.center.x);
  expect(Math.max(second.rectangle.top - first.rectangle.bottom, first.rectangle.top - second.rectangle.bottom)).toBe(
    72,
  );
  expect(secondChild.rectangle.location.subtract(second.rectangle.location)).toEqual(offset);
  expect(project.historyManager.recordStep).toHaveBeenCalledTimes(2);
});

it.each([
  [Direction.Left, "right"],
  [Direction.Up, "bottomCenter"],
  [Direction.Right, undefined],
  [Direction.Down, "topCenter"],
] as const)(
  "places a newly named node clear of its source and keeps the gap while editing in direction %s",
  async (direction, resizeAnchor) => {
    const source = textNode("source", 200, 200);
    source.isSelected = true;
    const add = vi.fn();
    const project = {
      stageManager: {
        getSelectedEntities: () => [source],
        getEntities: () => [source],
        getTextNodes: () => [source],
        getTextNodeByUUID: () => add.mock.calls[0][0],
        getAssociations: () => [],
        add,
      },
      nodeConnector: { connectConnectableEntity: vi.fn() },
      sectionInOutManager: { goInSections: vi.fn() },
      stageUtils: { replaceAutoNameTemplate: () => "A deliberately wide label" },
      syncAssociationManager: { syncFrom: vi.fn() },
      historyManager: { recordStep: vi.fn() },
    } as unknown as Project;
    const uuid = await new NodeAdder(project).addTextNodeFromCurrentSelectedNode(direction);
    const node: TextNode = add.mock.calls[0][0];
    const gap = () => {
      switch (direction) {
        case Direction.Left:
          return source.rectangle.left - node.rectangle.right;
        case Direction.Right:
          return node.rectangle.left - source.rectangle.right;
        case Direction.Up:
          return source.rectangle.top - node.rectangle.bottom;
        case Direction.Down:
          return node.rectangle.top - source.rectangle.bottom;
      }
    };
    expect(node.uuid).toBe(uuid);
    expect(node.rectangle.width).toBeGreaterThan(source.rectangle.width);
    expect(gap()).toBe(64);
    expect(project.nodeConnector.connectConnectableEntity).not.toHaveBeenCalled();
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();

    node.rename("An even wider title than the original one\nwith a second line", resizeAnchor);
    expect(gap()).toBe(64);
    if (direction === Direction.Up || direction === Direction.Down) {
      expect(node.rectangle.center.x).toBeCloseTo(source.rectangle.center.x);
    }
  },
);

it.each([
  [Direction.Up, new Vector(0, -85), new Vector(0, -185), new Vector(0.5, 0.01), new Vector(0.5, 0.99)],
  [Direction.Down, new Vector(0, 125), new Vector(0, 225), new Vector(0.5, 0.99), new Vector(0.5, 0.01)],
  [Direction.Left, new Vector(-225, 0), new Vector(-350, 0), new Vector(0.01, 0.5), new Vector(0.99, 0.5)],
  [Direction.Right, new Vector(225, 0), new Vector(350, 0), new Vector(0.99, 0.5), new Vector(0.01, 0.5)],
] as const)(
  "finds space past two obstacles and connects on side %s",
  async (direction, first, second, sourceRate, targetRate) => {
    const project = createDirectionalGrowthProject();
    const source = new TextNode(project, { text: "source" });
    const incoming = new TextNode(project, { text: "parent" });
    const horizontal = direction === Direction.Left || direction === Direction.Right;
    incoming.moveTo(horizontal ? new Vector(0, 450) : new Vector(450, 0));
    const obstacles = [first, second].map((position) => {
      const node = new TextNode(project, { text: "occupied" });
      node.moveTo(position);
      return node;
    });
    project.stage.push(source, incoming, obstacles[1], obstacles[0], lineEdge([incoming, source]));
    project.stageManager.updateReferences();
    source.isSelected = true;
    const recordStep = vi.fn();
    project.historyManager = { recordStep } as unknown as HistoryManager;

    const uuid = await project.nodeAdder.addTextNodeFromCurrentSelectedNode(direction, true);
    const created = project.stageManager.getTextNodeByUUID(uuid)!;
    const [edge] = project.graphMethods.getEdgesBetween(source, created);
    expect(edge.sourceRectangleRate).toEqual(sourceRate);
    expect(edge.targetRectangleRate).toEqual(targetRate);
    expect(project.stageManager.getSelectedEntities()).toEqual([created]);

    const backward = direction === Direction.Left || direction === Direction.Up;
    const axis = horizontal ? "x" : "y";
    const last = obstacles[1].rectangle;
    const location = created.rectangle.location;
    expect(horizontal ? location.y : created.rectangle.center.x).toBeCloseTo(
      horizontal ? source.rectangle.location.y : source.rectangle.center.x,
    );
    expect(location[axis]).toBe(
      backward ? last.location[axis] - created.rectangle.size[axis] - 16 : last.location[axis] + last.size[axis] + 16,
    );
    expect(recordStep).toHaveBeenCalledOnce();
  },
);

it.each([
  [Direction.Right, 150],
  [Direction.Down, 74],
  [Direction.Up, 74],
] as const)("uses the tree template and spacing for a connected node on side %s", async (direction, gap) => {
  const project = createDirectionalGrowthProject();
  project.historyManager = { recordStep: vi.fn() } as unknown as HistoryManager;
  project.syncAssociationManager.syncFrom = vi.fn();
  const name = vi.spyOn(project.stageUtils, "replaceAutoNameTemplate").mockReturnValue("Child");
  const source = new TextNode(project, { text: "source" });
  const parent = new TextNode(project, { text: "parent" });
  parent.moveTo(new Vector(-400, -400));
  const edge = lineEdge([parent, source]);
  edge.graphLayout = "mindMap";
  project.stage.push(source, parent, edge);
  source.isSelected = true;

  const uuid = await project.nodeAdder.addTextNodeFromCurrentSelectedNode(direction);
  const created = project.stageManager.getTextNodeByUUID(uuid)!;
  expect(name).toHaveBeenCalledWith(Settings.autoNamerTreeNodeTemplate, source);
  expect(created.text).toBe("Child");
  expect(project.graphMethods.getEdgesBetween(source, created)[0].graphLayout).toBe("mindMap");
  if (direction === Direction.Right) {
    expect(created.rectangle.left - source.rectangle.right).toBe(gap);
  } else {
    created.rename("A much wider child label\non two lines", direction === Direction.Up ? "bottomCenter" : "topCenter");
    expect(created.rectangle.center.x).toBeCloseTo(source.rectangle.center.x);
    const distance =
      direction === Direction.Up
        ? source.rectangle.top - created.rectangle.bottom
        : created.rectangle.top - source.rectangle.bottom;
    expect(distance).toBeCloseTo(gap);
  }
});

function createDirectionalGrowthProject() {
  const project = createProjectWithHistory();
  Object.assign(project, {
    nodeAdder: new NodeAdder(project),
    keyboardOnlyTreeEngine: new KeyboardOnlyTreeEngine(project),
    autoLayout: new AutoLayout(project),
    camera: { clearMoveCommander: vi.fn() },
    edgeRenderer: { getConnectedEffects: () => [] },
  });
  return project;
}

it.each([Direction.Left, Direction.Down])(
  "places a connected branch beside existing branches on side %s",
  async (direction) => {
    const project = createDirectionalGrowthProject();
    project.historyManager = { recordStep: vi.fn() } as unknown as HistoryManager;
    const left = direction === Direction.Left;
    const source = new TextNode(project, { text: "selected" });
    const branch = new TextNode(project, { text: "existing" });
    const other = new TextNode(project, { text: "other" });
    branch.moveTo(left ? new Vector(-300, 0) : new Vector(0, 250));
    other.moveTo(left ? new Vector(300, 360) : new Vector(420, -300));
    const incoming = lineEdge([branch, source]);
    incoming.sourceRectangleRate = left ? new Vector(0.99, 0.5) : new Vector(0.5, 0.01);
    incoming.targetRectangleRate = left ? new Vector(0.01, 0.5) : new Vector(0.5, 0.99);
    project.stage.push(source, branch, other, incoming, lineEdge([source, other]));
    source.isSelected = true;

    const uuid = await project.nodeAdder.addTextNodeFromCurrentSelectedNode(direction, true);
    const created = project.stageManager.getTextNodeByUUID(uuid)!;
    const [edge] = project.graphMethods.getEdgesBetween(source, created);
    if (left) {
      expect(created.rectangle.right).toBeLessThan(source.rectangle.left);
      expect(created.rectangle.top).toBe(branch.rectangle.bottom + 32);
      expect(edge.isRightToLeft()).toBe(true);
    } else {
      expect(created.rectangle.top).toBeGreaterThan(source.rectangle.bottom);
      expect(created.rectangle.left).toBe(branch.rectangle.right + 32);
      expect(edge.isTopToBottom()).toBe(true);
    }
    expect(created.rectangle.isCollideWith(branch.rectangle)).toBe(false);
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
  },
);

it("fills the square grid by rows by default and transposes it for vertical layout", () => {
  const project = { sectionMoveDepth: 0, historyManager: { recordStep: vi.fn() } } as unknown as Project;
  const layout = new LayoutManager(project);
  const step = 150;
  const at = (x: number, y: number) => ({ x: expect.closeTo(x * step, 8), y: expect.closeTo(y * step, 8) });
  const layoutPositions = (axis?: "horizontal" | "vertical") => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => textNode(id));
    const moveTo = nodes.map((node) => vi.spyOn(node, "moveTo").mockImplementation(() => {}));
    layout.layoutToSquare(nodes, axis);
    return moveTo.map((move) => move.mock.lastCall?.[0]);
  };

  expect(layoutPositions()).toEqual([at(-1, -0.5), at(0, -0.5), at(1, -0.5), at(-1, 0.5), at(0, 0.5)]);
  expect(layoutPositions("vertical")).toEqual([at(-0.5, -1), at(-0.5, 0), at(-0.5, 1), at(0.5, -1), at(0.5, 0)]);
});

it("adjusts selected-node spacing around the selection center and stops at the minimum gap", () => {
  const left = textNode("left");
  const right = textNode("right", 125);
  const untouched = textNode("untouched", 250);
  (right.collisionBox.shapes[0] as Rectangle).size.x = 60;
  left.isSelected = right.isSelected = true;
  const project = {
    stage: [left, right, untouched],
    sectionMoveDepth: 0,
    historyManager: { recordStep: vi.fn() },
  } as unknown as Project;
  for (const node of [left, right, untouched]) Object.assign(node, { project });
  project.stageManager = new StageManager(project);
  const layout = new LayoutManager(project);
  const gap = () => right.rectangle.left - left.rectangle.right;
  const center = () => (left.rectangle.left + right.rectangle.right) / 2;
  const originalCenter = center();

  layout.adjustSelectedNodeSpacing(true);
  expect(gap()).toBeGreaterThan(25);
  expect(center()).toBeCloseTo(originalCenter);
  expect(left.rectangle.width).toBe(100);
  expect(right.rectangle.width).toBe(60);
  expect(untouched.rectangle.left).toBe(250);
  layout.adjustSelectedNodeSpacing(false);
  expect(gap()).toBeCloseTo(25);
  layout.adjustSelectedNodeSpacing(false);
  layout.adjustSelectedNodeSpacing(false);
  expect(gap()).toBeCloseTo(12);
  expect(center()).toBeCloseTo(originalCenter);
  expect(layout.canAdjustSelectedNodeSpacing(false)).toBe(false);
  layout.adjustSelectedNodeSpacing(false);
  expect(project.historyManager.recordStep).toHaveBeenCalledTimes(4);
});

it("ungroups a collapsed nested section without deleting its nodes or their connection", () => {
  const first = textNode("first");
  const second = textNode("second");
  const connection = lineEdge([first, second]);
  const group = section("group", [first, second]);
  const parent = section("parent", [group]);
  group.isCollapsed = true;
  group.isSelected = true;
  const project = {
    stage: [parent, group, first, second, connection],
    syncAssociationManager: { onStageObjectDeleted: vi.fn() },
    historyManager: { recordStep: vi.fn() },
  } as unknown as Project;
  project.stageManager = new StageManager(project);
  project.deleteManager = new DeleteManager(project);
  project.sectionInOutManager = new SectionInOutManager(project);
  project.stageManager.updateReferences();

  new SectionPackManager(project).ungroupSection(group);

  expect(project.stage).toEqual([parent, first, second, connection]);
  expect(parent.children).toEqual([first, second]);
  expect(project.stageManager.getSelectedEntities()).toEqual([first, second]);
  expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
});

function createProjectWithHistory() {
  const project = {
    stage: [],
    sectionMoveDepth: 0,
    emit: vi.fn(),
    effects: { addEffect: vi.fn(), addEffects: vi.fn(), addMoveShadow: vi.fn() },
    edgeRenderer: { getCuttingEffects: () => [] },
    syncAssociationManager: { onStageObjectDeleted: vi.fn() },
    stageUtils: { replaceAutoNameTemplate: () => "New group" },
  } as unknown as Project;
  project.stageManager = new StageManager(project);
  project.deleteManager = new DeleteManager(project);
  project.nodeConnector = new NodeConnector(project);
  project.graphMethods = new GraphMethods(project);
  project.sectionMethods = new SectionMethods(project);
  project.sectionInOutManager = new SectionInOutManager(project);
  project.sectionPackManager = new SectionPackManager(project);
  project.sectionCollisionSolver = new SectionCollisionSolver(project);
  return project;
}

it("creates each qualifying nested group once as a tree expands past five descendants", () => {
  const project = createProjectWithHistory();
  project.autoLayout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  project.stageManager.add(root);
  project.historyManager = new HistoryManager(project);

  const descendants = project.autoLayout.growMindMap(
    root,
    Array.from({ length: 5 }, (_, index) => ({
      text: `Node ${index}`,
      parentIndex: index > 0 ? index - 1 : undefined,
    })),
  );
  expect(project.stageManager.getSections()).toHaveLength(0);
  project.historyManager.recordStep();

  const importer = new TreeImporter(project);
  expect(importer.importFromNode(descendants.at(-1)!.uuid, "Next\n  Last", 2)).toEqual({ success: true, nodeCount: 2 });
  const [outer] = project.stageManager.getRootSections();
  const inner = descendants[0].parentSection!;
  expect(outer.children[0]).toBe(root);
  expect(inner.parentSection).toBe(outer);
  expect(outer.mindMapBranch).toBe(true);
  expect(inner.mindMapBranch).toBe(true);
  expect(root.rectangle.isCollideWith(inner.rectangle)).toBe(false);
  expect(project.stageManager.getSections()).toHaveLength(2);
  expect(descendants[1].getFontSize()).toBeLessThan(descendants[0].getFontSize());
  expect(descendants[0].getFontSize()).toBeLessThan(root.getFontSize());
  project.historyManager.recordStep();

  project.autoLayout.formatMindMap(project.stageManager.getTextNodes());
  expect(project.stageManager.getSections()).toHaveLength(2);
  project.historyManager.undo();
  expect(project.stageManager.getSections()).toHaveLength(0);
  project.historyManager.redo();
  expect(project.stageManager.getRootSections()[0].mindMapBranch).toBe(true);
});

it.each([
  { groupedNode: "root", withNote: false },
  { groupedNode: "branch", withNote: false },
  { groupedNode: "root", withNote: true },
  { groupedNode: "branch", withNote: true },
])("reuses a manual group for the $groupedNode with note=$withNote", ({ groupedNode, withNote }) => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  const branch = new TextNode(project, { text: "Branch" });
  branch.moveTo(new Vector(500, 0));
  const leaves = Array.from({ length: 6 }, (_, index) => {
    const leaf = new TextNode(project, { text: `Leaf ${index}` });
    leaf.moveTo(new Vector(1000, index * 100));
    return leaf;
  });
  const nodes = [root, branch, ...leaves];
  const members = groupedNode === "root" ? [...leaves, branch, root] : [...leaves, branch];
  const note = new TextNode(project, { text: "注释" });
  if (withNote) {
    note.moveTo(new Vector(800, 800));
    members.push(note);
  }
  const manual = new Section(project, { text: "手动命名的分组", children: members });
  const links = [
    new LineEdge(project, { associationList: [root, branch] }),
    ...leaves.map((leaf) => new LineEdge(project, { associationList: [branch, leaf] })),
  ];
  project.stage.push(...nodes, ...(withNote ? [note] : []), manual, ...links);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);

  for (let attempt = 0; attempt < 2; attempt++) {
    expect(layout.formatMindMap(nodes)).toBe(true);
    const sections = project.stageManager.getSections();
    expect(sections).toHaveLength(2);
    const automatic = sections.find((section) => section.mindMapBranch)!;
    const outer = groupedNode === "root" ? manual : automatic;
    const inner = groupedNode === "branch" ? manual : automatic;
    expect(root.parentSection?.uuid).toBe(outer.uuid);
    expect(inner.parentSection?.uuid).toBe(outer.uuid);
    expect(branch.parentSection?.uuid).toBe(inner.uuid);
    expect(leaves.map((leaf) => leaf.parentSection?.uuid)).toEqual(leaves.map(() => inner.uuid));
    if (withNote) expect(note.parentSection).toBe(manual);
    expect(manual.text).toBe("手动命名的分组");
    expect(manual.mindMapBranch).toBeUndefined();
  }
});

it("fits deep automatic groups from the inside out and avoids an untouched sibling group", () => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  const leaf = new TextNode(project, { text: "Leaf" });
  const obstacle = new TextNode(project, { text: "A nearby group that extends across the new branch" });
  const outside = new TextNode(project, { text: "Outside" });
  leaf.moveTo(new Vector(85, 0));
  obstacle.moveTo(new Vector(260, 0));
  outside.moveTo(new Vector(3000, 0));
  const inner = new Section(project, { children: [root, leaf], mindMapBranch: true });
  const sibling = new Section(project, { children: [obstacle] });
  const middle = new Section(project, { children: [inner, sibling], mindMapBranch: true });
  const outer = new Section(project, { children: [middle], mindMapBranch: true });
  project.stage.push(root, leaf, obstacle, outside, inner, sibling, middle, outer, lineEdge([root, leaf]));
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  const siblingLocation = sibling.rectangle.location;
  expect(inner.rectangle.isCollideWith(sibling.rectangle)).toBe(false);

  expect(layout.formatMindMap([inner, outside])).toBe(true);

  expect(leaf.rectangle.left - root.rectangle.right).toBeCloseTo(315);
  expect(inner.rectangle.right - leaf.rectangle.right).toBeCloseTo(18);
  expect(middle.rectangle.right - Math.max(inner.rectangle.right, sibling.rectangle.right)).toBeCloseTo(26);
  expect(outer.rectangle.right - middle.rectangle.right).toBeCloseTo(36);
  expect(sibling.rectangle.right - obstacle.rectangle.right).toBeCloseTo(36);
  expect(sibling.rectangle.location).toEqual(siblingLocation);
  expect(inner.rectangle.expandFromCenter(Section.outerMargin).isCollideWith(sibling.rectangle)).toBe(false);
  for (const group of [inner, middle, outer]) {
    expect(group.children.every((child) => child.collisionBox.getRectangle().isAbsoluteIn(group.rectangle))).toBe(true);
  }
});

it.each([
  [false, 1],
  [false, -1],
  [true, 1],
  [true, -1],
] as const)("grows larger groups farther out (vertical=%s, sign=%s)", (vertical, sign) => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  const at = (depth: number, across: number) =>
    vertical ? new Vector(across, sign * depth) : new Vector(sign * depth, across);
  const groups = [
    [85, 25],
    [100, 20],
    [90, 35],
    [290, 105],
    [680, 520],
  ].map(([depth, across], index) => {
    const branch = new TextNode(project, { text: "Branch" });
    const leaf = new TextNode(project, { text: "Leaf" });
    const start = (index - 2) * 230;
    branch.moveTo(at(1200, start));
    leaf.moveTo(at(1200 + depth, start + across));
    const group = new Section(project, { children: [branch, leaf] });
    project.stage.push(branch, leaf, group, lineEdge([root, branch]), lineEdge([branch, leaf]));
    return { group, branch, leaf, offset: leaf.rectangle.location.subtract(branch.rectangle.location) };
  });
  project.stage.push(root);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);

  const selected = [root, ...groups.map(({ group }) => group)];
  expect(layout.formatMindMap(selected)).toBe(true);

  const bounds = groups.map(({ group }) => group.rectangle);
  const nearEdge = (r: Rectangle) => (vertical ? (sign > 0 ? r.top : -r.bottom) : sign > 0 ? r.left : -r.right);
  const farEdge = (r: Rectangle) => (vertical ? (sign > 0 ? r.bottom : -r.top) : sign > 0 ? r.right : -r.left);
  const crossSize = (r: Rectangle) => (vertical ? r.width : r.height);
  const small = bounds.slice(0, 3);
  for (const rect of small) expect(nearEdge(rect) - farEdge(root.rectangle)).toBeCloseTo(vertical ? 255 : 315);
  expect(nearEdge(bounds[3])).toBeGreaterThan(Math.max(...small.map(farEdge)));
  expect(nearEdge(bounds[4])).toBeGreaterThan(farEdge(bounds[3]));
  expect(crossSize(Rectangle.getBoundingRectangle(bounds))).toBeLessThan(
    bounds.reduce((sum, rect) => sum + crossSize(rect), 0),
  );
  bounds.forEach((rect, index) => {
    expect(bounds.slice(index + 1).some((other) => rect.isCollideWith(other))).toBe(false);
    const { branch, leaf, offset } = groups[index];
    expect(leaf.rectangle.location.subtract(branch.rectangle.location)).toEqual(offset);
  });
  expect(root.rectangle.location).toEqual(Vector.getZero());

  expect(layout.formatMindMap(selected)).toBe(true);
  expect(groups.map(({ group }) => group.rectangle.location)).toEqual(bounds.map((rect) => rect.location));
});

it("compacts a focused tree with nested automatic groups of different sizes", () => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  project.stage.push(root);
  const branches = [6, 6, 18, 6].map((leafCount, index) => {
    const branch = new TextNode(project, { text: `Branch ${index}` });
    const y = (index - 2) * 360;
    branch.moveTo(new Vector(1800, y));
    project.stage.push(branch, lineEdge([root, branch]));
    for (let index = 0; index < leafCount; index++) {
      const leaf = new TextNode(project, { text: "Leaf" });
      leaf.moveTo(new Vector(2400, y + (index - leafCount / 2) * 60));
      project.stage.push(leaf, lineEdge([branch, leaf]));
    }
    return branch;
  });
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);

  expect(layout.formatMindMap([root])).toBe(true);

  const [outer] = project.stageManager.getRootSections();
  const bounds = branches.map((node) => node.parentSection!.rectangle);
  expect(outer.children).toHaveLength(5);
  expect(bounds[2].left).toBeGreaterThan(Math.max(bounds[0].right, bounds[1].right, bounds[3].right));
  expect(bounds.every((rectangle) => rectangle.isAbsoluteIn(outer.rectangle))).toBe(true);
  expect(Rectangle.getBoundingRectangle(bounds).height).toBeLessThan(
    bounds.reduce((sum, rect) => sum + rect.height, 0),
  );

  expect(layout.formatMindMap([root])).toBe(true);
  expect(project.stageManager.getSections()).toHaveLength(5);
  branches.forEach((node, index) => {
    expect(node.parentSection!.rectangle.location.distance(bounds[index].location)).toBeCloseTo(0);
  });
});

it.each([undefined, true] as const)("reflows fully selected manual groups (auto child=%s)", (mindMapBranch) => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const makeNode = (text: string, x: number, y: number, fontScaleLevel: number) => {
    const node = new TextNode(project, { text, fontScaleLevel });
    node.moveTo(new Vector(x, y));
    project.stage.push(node);
    return node;
  };
  const root = makeNode("Root", 0, 0, 0);
  const branch = makeNode("Application", 750, 0, -1);
  const top = makeNode("Routing", 1250, -1800, -2);
  const bottom = makeNode("Testing", 1250, 1800, -2);
  const large = makeNode("Performance", 2400, 0, -2);
  const leaves = Array.from({ length: 6 }, (_, index) => makeNode("Leaf", 3000, (index - 3) * 110, -2));
  const largeGroup = new Section(project, { text: "Performance", children: [large, ...leaves], mindMapBranch });
  const manual = new Section(project, { text: "Application", children: [branch, top, bottom, largeGroup] });
  const outer = new Section(project, { text: "Root", children: [root, manual] });
  project.stage.push(
    largeGroup,
    manual,
    outer,
    lineEdge([root, branch]),
    lineEdge([branch, top]),
    lineEdge([branch, bottom]),
    lineEdge([branch, large]),
    ...leaves.map((leaf) => lineEdge([large, leaf])),
  );
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  const originalGap = bottom.rectangle.top - top.rectangle.bottom;

  expect(layout.formatMindMap([root, branch, top])).toBe(true);
  expect(bottom.rectangle.top - top.rectangle.bottom).toBeCloseTo(originalGap);

  expect(layout.formatMindMap(project.graphMethods.getSuccessorSet(root, true, true))).toBe(true);
  expect(bottom.rectangle.top - top.rectangle.bottom).toBeLessThan(100);
  expect(largeGroup.rectangle.left).toBeGreaterThan(Math.max(top.rectangle.right, bottom.rectangle.right));
  expect(manual.parentSection).toBe(outer);
  expect(largeGroup.rectangle.isAbsoluteIn(manual.rectangle)).toBe(true);
  expect(project.stageManager.getSections()).toHaveLength(3);
});

it("formats an existing tree by shrinking text and sibling gaps with depth while keeping the layer gap fixed", () => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const [root, upper, lower, upperFirst, upperSecond, lowerFirst, lowerSecond] = [
    [0, 0],
    [400, -200],
    [400, 200],
    [800, -300],
    [800, -100],
    [800, 100],
    [800, 300],
  ].map(([x, y], index) => {
    const text = index === 2 ? "A branch with a much wider label" : "Branch";
    const node = new TextNode(project, { text, fontScaleLevel: 1 });
    node.moveTo(new Vector(x, y));
    return node;
  });
  const nodes = [root, upper, lower, upperFirst, upperSecond, lowerFirst, lowerSecond];
  const links = [
    [root, upper],
    [root, lower],
    [upper, upperFirst],
    [upper, upperSecond],
    [lower, lowerFirst],
    [lower, lowerSecond],
  ];
  project.stage.push(...nodes, ...links.map((associationList) => new LineEdge(project, { associationList })));
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  const rootFont = root.getFontSize();

  expect(layout.formatMindMap(nodes)).toBe(true);

  const [group] = project.stageManager.getRootSections();
  expect(group.mindMapBranch).toBe(true);
  expect(root.getFontSize()).toBe(rootFont);
  expect(upper.getFontSize()).toBeLessThan(rootFont);
  expect(upperFirst.getFontSize()).toBeLessThan(upper.getFontSize());
  for (const [parent, child] of links) {
    expect(child.rectangle.left - parent.rectangle.right).toBeCloseTo(315);
  }
  const upperBounds = Rectangle.getBoundingRectangle([upper, upperFirst, upperSecond].map((node) => node.rectangle));
  const lowerBounds = Rectangle.getBoundingRectangle([lower, lowerFirst, lowerSecond].map((node) => node.rectangle));
  expect(lowerBounds.top - upperBounds.bottom).toBeCloseTo(62);
  expect(upperSecond.rectangle.top - upperFirst.rectangle.bottom).toBeCloseTo(62 * 0.88);

  upperFirst.setFontScaleLevel(1);
  expect(layout.formatMindMap([group])).toBe(true);
  expect(upperFirst.getFontSize()).toBeLessThan(upper.getFontSize());
  expect(project.stageManager.getRootSections()).toEqual([group]);
});

it("uses a single selected node as the center for spacing and font sizes on both sides of the links", () => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const center = new TextNode(project, { text: "中心" });
  center.setFontScaleLevel(1);
  const [left, right, top, bottom, leaf, unrelated] = [
    [-500, 0],
    [500, 0],
    [0, -500],
    [0, 500],
    [950, 0],
    [950, 950],
  ].map(([x, y]) => {
    const node = new TextNode(project, { text: "节点" });
    node.moveTo(new Vector(x, y));
    return node;
  });
  const links = [
    [left, center],
    [center, right],
    [center, top],
    [center, bottom],
    [right, leaf],
  ].map((associationList) => new LineEdge(project, { associationList }));
  project.stage.push(center, left, right, top, bottom, leaf, unrelated, ...links);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  const centerPosition = center.rectangle.location;
  const unrelatedPosition = unrelated.rectangle.location;
  const unrelatedSize = unrelated.getFontSize();

  expect(layout.formatMindMap([center])).toBe(true);

  expect(center.rectangle.location).toEqual(centerPosition);
  expect(center.fontScaleLevel).toBe(1);
  for (const neighbor of [left, right, top, bottom]) {
    expect(neighbor.fontScaleLevel).toBe(0);
    expect(neighbor.getFontSize()).toBeLessThan(center.getFontSize());
  }
  expect(leaf.fontScaleLevel).toBe(-1);
  expect(leaf.getFontSize()).toBeLessThan(right.getFontSize());
  expect(leaf.rectangle.left - right.rectangle.right).toBeCloseTo(315);
  expect(right.rectangle.left - center.rectangle.right).toBeCloseTo(315);
  expect(center.rectangle.left - left.rectangle.right).toBeCloseTo(315);
  expect(center.rectangle.top - top.rectangle.bottom).toBeCloseTo(255);
  expect(bottom.rectangle.top - center.rectangle.bottom).toBeCloseTo(255);
  expect(links[0]).toMatchObject({ source: left, target: center });
  expect(unrelated.rectangle.location).toEqual(unrelatedPosition);
  expect(unrelated.getFontSize()).toBe(unrelatedSize);
});

it("updates every enclosing group when a formatted inner tree shifts to avoid a sibling", () => {
  const project = createProjectWithHistory();
  const layout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  const leaf = new TextNode(project, { text: "Leaf" });
  const sibling = new TextNode(project, { text: "X" });
  leaf.moveTo(new Vector(90, 0));
  sibling.moveTo(new Vector(leaf.rectangle.right + Section.contentPadding + 5, 0));
  const inner = new Section(project, { children: [root, leaf] });
  const parent = new Section(project, { children: [inner, sibling] });
  const outer = new Section(project, { children: [parent] });
  const edge = new LineEdge(project, { associationList: [root, leaf] });
  project.stage.push(root, leaf, sibling, inner, parent, outer, edge);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  const before = root.rectangle.location;
  expect(inner.rectangle.isCollideWith(sibling.rectangle)).toBe(false);

  expect(layout.formatMindMap([root, leaf])).toBe(true);

  expect(root.rectangle.left).toBeGreaterThan(before.x);
  expect(inner.rectangle.isCollideWith(sibling.rectangle)).toBe(false);
  expect(inner.rectangle.isAbsoluteIn(parent.rectangle)).toBe(true);
  expect(parent.rectangle.isAbsoluteIn(outer.rectangle)).toBe(true);
  expect(leaf.rectangle.isAbsoluteIn(outer.rectangle)).toBe(true);
  const groups = [inner, parent, outer];
  const bounds = groups.map((group) => group.rectangle);
  project.stageManager.refreshAllStageObjects();
  for (const [index, { rectangle }] of groups.entries()) {
    expect(rectangle.location.distance(bounds[index].location)).toBeCloseTo(0, 8);
    expect(rectangle.size.distance(bounds[index].size)).toBeCloseTo(0, 8);
  }
});

it("keeps an expanded branch inside its existing group and clears a locked neighboring group", () => {
  const project = createProjectWithHistory();
  project.autoLayout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  const manual = new Section(project, { children: [root] });
  const neighbor = new TextNode(project, { text: "Neighbor" });
  neighbor.moveTo(new Vector(230, 0));
  const locked = new Section(project, { children: [neighbor], locked: true });
  project.stage.push(root, manual, neighbor, locked);
  project.stageManager.updateReferences();
  const before = locked.rectangle.clone();
  const width = manual.rectangle.width;

  const nodes = project.autoLayout.growMindMap(root, [{ text: "Child" }, { text: "Leaf", parentIndex: 0 }]);

  expect(nodes.every((node) => node.parentSection === manual)).toBe(true);
  expect(manual.rectangle.width).toBeGreaterThan(width);
  expect(manual.rectangle.isCollideWith(locked.rectangle)).toBe(false);
  expect(locked.rectangle).toEqual(before);
  expect(nodes[1].rectangle.left).toBeGreaterThan(nodes[0].rectangle.right);
});

it("uses the actual AI-generated theme as the root and starts clear of existing groups", () => {
  const project = createProjectWithHistory();
  project.autoLayout = new AutoLayout(project);
  const existing = new TextNode(project, { text: "Existing diagram" });
  const group = new Section(project, { children: [existing], locked: true });
  project.stage.push(existing, group);
  project.stageManager.updateReferences();

  new TreeImporter(project).import("Theme\n  Child\n    Detail", 2, Vector.getZero(), true);

  const [, root, child, detail] = project.stageManager.getTextNodes();
  expect([root.text, child.text, detail.text]).toEqual(["Theme", "Child", "Detail"]);
  expect(project.graphMethods.getEdgesBetween(root, child)[0].graphLayout).toBe("mindMap");
  expect(project.graphMethods.getEdgesBetween(child, detail)[0].graphLayout).toBe("mindMap");
  expect([root, child, detail].every((node) => !group.rectangle.isCollideWith(node.rectangle))).toBe(true);
});

it("checks the expanded group after an automatic-width text node is edited", () => {
  const previous = Settings.isEnableEntityCollision;
  Settings.isEnableEntityCollision = true;
  try {
    const project = createProjectWithHistory();
    Object.assign(project.syncAssociationManager, { syncFrom: vi.fn() });
    const member = new TextNode(project, { text: "Short" });
    const group = new Section(project, { children: [member] });
    const neighbor = new TextNode(project, { text: "Nearby" });
    neighbor.moveTo(new Vector(180, 0));
    project.stage.push(group, member, neighbor);
    project.stageManager.updateReferences();
    const originalWidth = group.rectangle.width;
    const originalNeighborLocation = neighbor.rectangle.location;

    member.rename("A much wider member label that expands its group");

    expect(group.rectangle.width).toBeGreaterThan(originalWidth);
    expect(group.rectangle.isCollideWith(neighbor.rectangle)).toBe(false);
    expect(neighbor.rectangle.location).not.toEqual(originalNeighborLocation);
  } finally {
    Settings.isEnableEntityCollision = previous;
  }
});

it("moves a selected group as one tree item even when its members are also selected", () => {
  const project = createProjectWithHistory();
  project.autoLayout = new AutoLayout(project);
  const root = new TextNode(project, { text: "Root" });
  const first = new TextNode(project, { text: "First" });
  const second = new TextNode(project, { text: "Second" });
  first.moveTo(new Vector(600, 0));
  second.moveTo(new Vector(680, 100));
  const group = new Section(project, { children: [first, second] });
  const edge = new LineEdge(project, { associationList: [root, first] });
  const offset = second.rectangle.location.subtract(first.rectangle.location);
  const position = group.rectangle.location;
  project.stage.push(root, first, second, group, edge);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  first.isSelected = second.isSelected = group.isSelected = true;

  expect(project.autoLayout.formatMindMap([root, group, first, second])).toBe(true);

  expect(group.rectangle.location).not.toEqual(position);
  expect(second.rectangle.location.subtract(first.rectangle.location)).toEqual(offset);
  expect(group.rectangle.isCollideWith(root.rectangle)).toBe(false);
});

it.each([1, 0.1])("picks a group border within the same screen distance at zoom %s", (currentScale) => {
  const project = createProjectWithHistory();
  project.camera = { currentScale } as Project["camera"];
  project.renderer = { frameIndex: 0, w: 800, h: 600 } as Project["renderer"];
  vi.spyOn(project.sectionMethods, "isSectionBigTitleActive").mockReturnValue(false);
  const member = new TextNode(project, { text: "Member" });
  const group = new Section(project, { children: [member] });
  project.stage.push(member, group);
  project.stageManager.updateReferences();
  const { right, center } = group.rectangle;

  expect(project.stageManager.findEntityByLocation(new Vector(right + 5 / currentScale, center.y))?.uuid).toBe(
    group.uuid,
  );
  const outside = right + Math.max(13, 7 / currentScale);
  expect(project.stageManager.findEntityByLocation(new Vector(outside, center.y))?.uuid).toBeUndefined();
  expect(project.stageManager.findEntityByLocation(member.rectangle.rightCenter)?.uuid).toBe(member.uuid);
});

it("lays out a group without pushing unrelated nodes when entity collision is enabled", () => {
  const previous = Settings.isEnableEntityCollision;
  Settings.isEnableEntityCollision = true;
  try {
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "member" });
    member.isSelected = true;
    const group = new Section(project, { text: "group", children: [member] });
    const peer = new TextNode(project, { text: "peer" });
    peer.moveTo(new Vector(180, 0));
    const neighbor = new TextNode(project, { text: "neighbor" });
    const center = Rectangle.getBoundingRectangle([group.rectangle, peer.rectangle]).center;
    const cellSize = Math.max(group.rectangle.width, group.rectangle.height) + 50;
    const neighborLocation = center.subtract(new Vector(cellSize / 2, 0));
    neighbor.moveTo(neighborLocation);
    project.stage.push(member, group, peer, neighbor);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);
    const memberOffset = member.rectangle.location.subtract(group.rectangle.location);
    const layout = new LayoutManager(project);

    layout.layoutToSquare([group, peer]);

    expect(group.rectangle.isCollideWith(neighbor.rectangle)).toBe(true);
    expect(neighbor.rectangle.location).toEqual(neighborLocation);
    expect(member.rectangle.location.distance(group.rectangle.location.add(memberOffset))).toBeCloseTo(0);
    expect(member.isSelected).toBe(true);
    project.historyManager.undo();
    expect(project.historyManager.canUndo).toBe(false);
  } finally {
    Settings.isEnableEntityCollision = previous;
  }
});

it("applies tidy tree layout to the contents of a selected section in one undo step", async () => {
  const project = createProjectWithHistory();
  const root = new TextNode(project, { text: "Root" });
  const first = new TextNode(project, { text: "First" });
  const second = new TextNode(project, { text: "Second" });
  const outside = new TextNode(project, { text: "Outside" });
  outside.moveTo(new Vector(-500, 0));
  const group = new Section(project, { text: "Tree", children: [root, first, second] });
  const reference = lineEdge([first, second]);
  reference.lineType = "dashed";
  project.stage.push(root, first, second, outside, group, lineEdge([root, first]), lineEdge([root, second]), reference);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);
  group.isSelected = true;
  const layout = new LayoutManager(project);

  expect(layout.canLayoutSelectedGraph()).toBe(true);
  await expect(layout.layoutSelectedGraph("tidyTree")).resolves.toBeUndefined();
  expect(root.rectangle.location).toEqual(new Vector(0, 0));
  expect(first.rectangle.left).toBeGreaterThan(root.rectangle.right);
  expect(second.rectangle.top).toBeGreaterThan(first.rectangle.bottom);
  expect(outside.rectangle.location).toEqual(new Vector(-500, 0));
  project.historyManager.undo();
  expect(project.historyManager.canUndo).toBe(false);
});

describe("moving connected nodes", () => {
  function chain() {
    const project = createProjectWithHistory();
    const [a, b, c] = ["a", "b", "c"].map((text, index) => {
      const node = new TextNode(project, { text });
      node.moveTo(new Vector(300 * index, 0));
      return node;
    });
    const ab = lineEdge([a, b]);
    const bc = lineEdge([b, c]);
    project.stage.push(a, b, c, ab, bc);
    project.stageManager.updateReferences();
    for (const edge of [ab, bc]) {
      project.stageManager.changeEdgesConnectLocation([edge], Direction.Right, true, false);
      project.stageManager.changeEdgesConnectLocation([edge], Direction.Left, false, false);
      edge.graphLayout = "mindMap";
    }
    return { project, a, b, c, ab, bc, mover: new EntityMoveManager(project) };
  }

  it("flips the last edge of a chain when only its target moves across its source", () => {
    const { b, c, ab, bc, mover } = chain();
    bc.targetRectangleRate = new Vector(0.5, 0.01);
    const untouched = ab.bodyLine;
    c.isSelected = true;
    mover.moveSelectedEntities(new Vector(-450, 0));

    expect(ab.bodyLine).toBe(untouched);
    expect(bc.bodyLine.start).toEqual(b.rectangle.leftCenter);
    expect(bc.bodyLine.end).toEqual(c.rectangle.rightCenter);
    expect(bc.target).toBe(c);
    expect(bc.targetRectangleRate).toEqual(new Vector(0.5, 0.01));
  });

  it.each(["regular", "tree"] as const)(
    "moves selected nodes together in %s mode and flips only the edge crossing the selection",
    (mode) => {
      const { a, b, c, ab, bc, mover } = chain();
      const delta = new Vector(-500, 0);
      const previous = bc.bodyLine;
      b.isSelected = c.isSelected = true;
      if (mode === "tree") mover.moveEntitiesWithChildren(delta);
      else mover.moveSelectedEntities(delta);

      expect(ab.bodyLine.start).toEqual(a.rectangle.leftCenter);
      expect(ab.bodyLine.end).toEqual(b.rectangle.rightCenter);
      expect(bc.bodyLine.start).toEqual(previous.start.add(delta));
      expect(bc.bodyLine.end).toEqual(previous.end.add(delta));
    },
  );

  it("keeps a branch below its parent when growing another child after dragging it down", () => {
    vi.useFakeTimers();
    const autoLayout = Settings.autoLayoutWhenTreeGenerate;
    Settings.autoLayoutWhenTreeGenerate = true;
    try {
      const { project, b, c, ab, bc, mover } = chain();
      ab.graphLayout = bc.graphLayout = undefined;
      Object.assign(project, {
        entityMoveManager: mover,
        autoLayout: new AutoLayout(project),
        autoLayoutFastTree: new AutoLayoutFastTree(project),
        autoAlign: new AutoAlign(project),
        camera: { clearMoveCommander: vi.fn() },
        historyManager: { recordStep: vi.fn() },
        edgeRenderer: { getConnectedEffects: () => [] },
        controllerUtils: { editTextNode: vi.fn() },
      });
      c.isSelected = true;
      mover.moveSelectedEntities(new Vector(b.rectangle.center.x - c.rectangle.center.x, 280));
      expect(bc.bodyLine.start).toEqual(b.rectangle.bottomCenter);

      const engine = new KeyboardOnlyTreeEngine(project);
      engine.generateChildNode("child");

      const grown = project.stageManager.getTextNodes().at(-1)!;
      expect(grown).not.toBe(c);
      expect(c.rectangle.top).toBeGreaterThan(b.rectangle.bottom);
      expect(c.rectangle.center.x).toBeCloseTo(b.rectangle.center.x);
      expect(grown.rectangle.top).toBeGreaterThan(c.rectangle.bottom);
      expect(grown.rectangle.center.x).toBeCloseTo(c.rectangle.center.x);
      expect(bc.sourceRectangleRate).toEqual(new Vector(0.99, 0.5));
      expect(project.graphMethods.getEdgesBetween(c, grown)[0].isTopToBottom()).toBe(true);
    } finally {
      Settings.autoLayoutWhenTreeGenerate = autoLayout;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe("drag collision timing", () => {
  const initialEntityCollision = Settings.isEnableEntityCollision;
  const initialSectionCollision = Settings.isEnableSectionCollision;
  beforeEach(() => {
    Settings.isEnableEntityCollision = true;
    Settings.isEnableSectionCollision = false;
  });
  afterEach(() => {
    Settings.isEnableEntityCollision = initialEntityCollision;
    Settings.isEnableSectionCollision = initialSectionCollision;
  });

  function setupNodes(...locations: [number, number][]) {
    const project = createProjectWithHistory();
    const nodes = locations.map(([x, y]) => {
      const node = new TextNode(project, { text: "node" });
      node.moveTo(new Vector(x, y));
      return node;
    });
    project.stage.push(...nodes);
    return { project, nodes, mover: new EntityMoveManager(project) };
  }

  it.each(["single", "multi", "tree"] as const)(
    "leaves nodes along the drag path in place and resolves the drop in %s mode",
    (mode) => {
      const { project, nodes, mover } = setupNodes([0, 0], [0, 160], [120, 0], [260, mode === "single" ? 0 : 160]);
      const [first, second, alongPath, atDrop] = nodes;
      first.isSelected = true;
      if (mode === "multi") second.isSelected = true;
      if (mode === "tree") project.stage.push(lineEdge([first, second]));
      const draggedAtDrop = mode === "single" ? first : second;
      const originalPathLocation = alongPath.rectangle.location;
      const originalDropLocation = atDrop.rectangle.location;

      mover.dragSelectedEntities(new Vector(120, 0), mode === "tree");
      expect(first.rectangle.isCollideWith(alongPath.rectangle)).toBe(true);
      expect(alongPath.rectangle.location).toEqual(originalPathLocation);
      mover.dragSelectedEntities(new Vector(120, 0), mode === "tree");
      expect(draggedAtDrop.rectangle.isCollideWith(atDrop.rectangle)).toBe(true);
      expect(atDrop.rectangle.location).toEqual(originalDropLocation);
      mover.finishDragging(() => {});

      expect(first.rectangle.location).toEqual(new Vector(240, 0));
      expect(draggedAtDrop.rectangle.left).toBe(240);
      expect(alongPath.rectangle.location).toEqual(originalPathLocation);
      expect(atDrop.rectangle.location).not.toEqual(originalDropLocation);
      expect(draggedAtDrop.rectangle.isCollideWith(atDrop.rectangle)).toBe(false);
      expect(project.deferredMoveCollisions).toBeUndefined();
    },
  );

  it("checks for collisions after snapping and respects the collision setting", () => {
    const { nodes, mover } = setupNodes([0, 0], [260, 0], [520, 0]);
    const [dragged, first, second] = nodes;
    dragged.isSelected = true;
    mover.dragSelectedEntities(new Vector(190, 0), false);
    expect(dragged.rectangle.isCollideWith(first.rectangle)).toBe(false);
    mover.finishDragging(() => {
      dragged.move(new Vector(50, 0));
      expect(dragged.rectangle.isCollideWith(first.rectangle)).toBe(true);
      expect(first.rectangle.location).toEqual(new Vector(260, 0));
    });
    expect(dragged.rectangle.isCollideWith(first.rectangle)).toBe(false);
    expect(first.rectangle.location).not.toEqual(new Vector(260, 0));

    Settings.isEnableEntityCollision = false;
    mover.dragSelectedEntities(new Vector(260, 0), false);
    mover.finishDragging(() => {});
    expect(dragged.rectangle.isCollideWith(second.rectangle)).toBe(true);
    expect(second.rectangle.left).toBe(520);
  });

  it.each(["node", "section"] as const)("pushes a neighboring %s when the dragged child expands its group", (kind) => {
    const { project, nodes, mover } = setupNodes([0, 0], [100, 0], [0, 0]);
    const [anchor, dragged, neighbor] = nodes;
    const parent = new Section(project, { children: [anchor, dragged] });
    const gap = kind === "section" ? 40 : 10;
    const before = new Vector(dragged.rectangle.right + 200 + gap, 0);
    neighbor.moveTo(before);
    const obstacle = kind === "section" ? new Section(project, { children: [neighbor] }) : neighbor;
    project.stage.push(parent);
    if (obstacle !== neighbor) project.stage.push(obstacle);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);
    dragged.isSelected = true;

    mover.dragSelectedEntities(new Vector(200, 0), false);
    expect(dragged.rectangle.isCollideWith(obstacle.rectangle)).toBe(false);
    expect(parent.rectangle.isCollideWith(obstacle.rectangle)).toBe(true);
    expect(neighbor.rectangle.location).toEqual(before);
    mover.finishDragging(() => {});
    project.historyManager.recordStep();

    expect(dragged.rectangle.left).toBe(300);
    expect(neighbor.rectangle.left).toBeGreaterThan(before.x);
    expect(parent.rectangle.isCollideWith(obstacle.rectangle)).toBe(false);
    project.historyManager.undo();
    expect(project.stageManager.get(dragged.uuid)?.collisionBox.getRectangle().left).toBe(100);
    expect(project.stageManager.get(neighbor.uuid)?.collisionBox.getRectangle().location).toEqual(before);
  });

  it.each(["section", "child"] as const)("defers sibling section collisions when dragging a %s", (target) => {
    Settings.isEnableEntityCollision = false;
    Settings.isEnableSectionCollision = true;
    const { project, nodes, mover } = setupNodes([0, 0], [140, 0], [350, 0]);
    const [dragged, alongPath, atDrop] = nodes;
    const [parent, pathSection, dropSection] = nodes.map((node) => new Section(project, { children: [node] }));
    project.stage.push(parent, pathSection, dropSection);
    project.stageManager.updateReferences();
    const selected = target === "section" ? parent : dragged;
    selected.isSelected = true;

    mover.dragSelectedEntities(new Vector(140, 0), false);
    expect(parent.rectangle.isCollideWith(pathSection.rectangle)).toBe(true);
    expect(alongPath.rectangle.left).toBe(140);
    mover.dragSelectedEntities(new Vector(180, 0), false);
    expect(parent.rectangle.isCollideWith(dropSection.rectangle)).toBe(true);
    expect(atDrop.rectangle.left).toBe(350);
    mover.finishDragging(() => {});

    expect(dragged.rectangle.left).toBe(320);
    expect(alongPath.rectangle.left).toBe(140);
    expect(atDrop.rectangle.left).toBeGreaterThan(350);
    expect(parent.rectangle.isCollideWith(dropSection.rectangle)).toBe(false);
  });
});

it("undoes and redoes a batch of new connections and a batch of edge conversions independently", () => {
  const project = createProjectWithHistory();
  const nodes = ["a", "b", "c"].map((text, index) => {
    const node = new TextNode(project, { text });
    node.moveTo(new Vector(index * 150, 0));
    node.isSelected = true;
    return node;
  });
  project.stage.push(...nodes);
  project.historyManager = new HistoryManager(project);

  ConnectNodeSmartTools.connectRight(project);
  const lines = project.stageManager.getLineEdges();
  expect(lines).toHaveLength(2);
  lines.forEach((line) => (line.isSelected = true));
  project.stageManager.switchEdgeToArcEdge();
  expect(project.stageManager.getAssociations().every((edge) => edge instanceof ArcEdge)).toBe(true);

  project.historyManager.undo();
  expect(project.stageManager.getLineEdges().map((edge) => [edge.source.uuid, edge.target.uuid])).toEqual([
    [nodes[0].uuid, nodes[1].uuid],
    [nodes[1].uuid, nodes[2].uuid],
  ]);
  project.historyManager.undo();
  expect(project.stageManager.getAssociations()).toHaveLength(0);
  expect(project.historyManager.canUndo).toBe(false);

  project.historyManager.redo();
  expect(project.stageManager.getLineEdges()).toHaveLength(2);
  project.historyManager.redo();
  expect(project.stageManager.getAssociations()).toHaveLength(2);
  expect(project.stageManager.getAssociations().every((edge) => edge instanceof ArcEdge)).toBe(true);
  expect(project.historyManager.canRedo).toBe(false);
});

it("groups all children of an existing group with one undo and preserves the outer group", () => {
  const project = createProjectWithHistory();
  const nodes = ["a", "b"].map((text) => new TextNode(project, { text }));
  const parent = new Section(project, { text: "Outer group", children: nodes });
  project.stage.push(parent, ...nodes);
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);

  const inner = project.sectionPackManager.packEntityToSection(nodes)!;
  expect(parent.children).toEqual([inner]);
  expect(inner.children).toEqual(nodes);
  expect(inner.parentSection).toBe(parent);

  project.historyManager.undo();
  const [restoredParent] = project.stageManager.getSections();
  expect(project.stageManager.getSections()).toHaveLength(1);
  expect(restoredParent.children.map((child) => child.uuid)).toEqual(nodes.map((node) => node.uuid));
  expect(project.historyManager.canUndo).toBe(false);

  project.historyManager.redo();
  const [outer, nested] = project.stageManager.getSections();
  expect(outer.children).toEqual([nested]);
  expect(nested.children.map((child) => child.uuid)).toEqual(nodes.map((node) => node.uuid));
  expect(project.historyManager.canRedo).toBe(false);
});

it("keeps a long root node's entire text as the new group title", () => {
  const project = createProjectWithHistory();
  const title = "项目分组需要完整保留根节点的标题\n第二行也需要保留";
  const root = new TextNode(project, { text: title });
  const child = new TextNode(project, { text: "子节点" });
  project.stage.push(root, child, LineEdge.fromTwoEntity(project, root, child));
  project.stageManager.updateReferences();
  project.historyManager = new HistoryManager(project);

  const group = project.sectionPackManager.packEntityToSection([root, child]);

  expect(group?.text).toBe(title);
  expect(group?.titleBarHeight).toBe(74);
});

it.each(["cover", "top"] as const)("redraws %s group titles at the restored position after undo and redo", (mode) => {
  const previousMode = Settings.sectionBitTitleRenderType;
  const previousThreshold = Settings.sectionBigTitleCameraScaleThreshold;
  Settings.sectionBitTitleRenderType = mode;
  Settings.sectionBigTitleCameraScaleThreshold = 0.45;
  try {
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "成员" });
    const group = new Section(project, { text: "基础", children: [member] });
    project.stage.push(group, member);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);
    project.camera = { currentScale: 0.1 } as Project["camera"];
    project.renderer = { frameIndex: 0, isOverView: () => false } as unknown as Project["renderer"];
    const drawTitle = vi.fn<(section: Section) => void>();
    const drawBackground = vi.fn<(section: Section) => void>();
    project.sectionRenderer = {
      renderBackgroundColor: drawBackground,
      renderBigCoveredTitle: drawTitle,
      renderTopTitle: drawTitle,
    } as unknown as Project["sectionRenderer"];
    const renderer = new EntityRenderer(project);
    const viewport = new Rectangle(Vector.getZero(), new Vector(1200, 800));

    function expectFrameAt(left: number) {
      const [currentGroup] = project.stageManager.getSections();
      expect(currentGroup.rectangle.left).toBe(left);
      drawBackground.mockClear();
      drawTitle.mockClear();
      renderer.renderAllSectionsBackground(viewport);
      renderer.renderAllSectionsBigTitle(viewport);
      expect(drawBackground.mock.calls.map(([drawn]) => drawn.rectangle.left)).toEqual([left]);
      expect(drawTitle.mock.calls.map(([drawn]) => drawn.rectangle.left)).toEqual([left]);
    }

    const originalLeft = group.rectangle.left;
    group.move(new Vector(240, 0));
    project.historyManager.recordStep();
    expectFrameAt(originalLeft + 240);
    project.historyManager.undo();
    expectFrameAt(originalLeft);
    project.historyManager.redo();
    expectFrameAt(originalLeft + 240);
  } finally {
    Settings.sectionBitTitleRenderType = previousMode;
    Settings.sectionBigTitleCameraScaleThreshold = previousThreshold;
  }
});

describe("new group collisions", () => {
  const initialEntityCollision = Settings.isEnableEntityCollision;
  const initialSectionCollision = Settings.isEnableSectionCollision;
  beforeEach(() => {
    Settings.isEnableEntityCollision = true;
    Settings.isEnableSectionCollision = false;
  });
  afterEach(() => {
    Settings.isEnableEntityCollision = initialEntityCollision;
    Settings.isEnableSectionCollision = initialSectionCollision;
  });

  it.each([true, false])(
    "uses the entity collision setting (%s) and records the result in the group step",
    (enabled) => {
      Settings.isEnableEntityCollision = enabled;
      const project = createProjectWithHistory();
      const member = new TextNode(project, { text: "member" });
      const neighbor = new TextNode(project, { text: "neighbor" });
      const before = new Vector(member.rectangle.right + 10, 0);
      neighbor.moveTo(before);
      project.stage.push(member, neighbor);
      project.stageManager.updateReferences();
      project.historyManager = new HistoryManager(project);

      const group = project.sectionPackManager.packEntityToSection([member])!;

      expect(member.rectangle.location).toEqual(Vector.getZero());
      expect(group.rectangle.isCollideWith(neighbor.rectangle)).toBe(!enabled);
      const after = neighbor.rectangle.location.clone();
      if (enabled) expect(after.x).toBeGreaterThan(before.x);
      else expect(after).toEqual(before);

      project.historyManager.undo();
      expect(project.stageManager.getSections()).toHaveLength(0);
      expect(project.stageManager.get(neighbor.uuid)?.collisionBox.getRectangle().location).toEqual(before);
      expect(project.historyManager.canUndo).toBe(false);
      project.historyManager.redo();
      expect(project.stageManager.get(neighbor.uuid)?.collisionBox.getRectangle().location).toEqual(after);
    },
  );

  it("runs group collision independently of entity collision", () => {
    Settings.isEnableEntityCollision = false;
    Settings.isEnableSectionCollision = true;
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "member" });
    const neighbor = new TextNode(project, { text: "neighbor" });
    const before = member.rectangle.right + 2 * Section.contentPadding + 5;
    neighbor.moveTo(new Vector(before, 0));
    const sibling = new Section(project, { text: "sibling", children: [neighbor] });
    project.stage.push(member, neighbor, sibling);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);

    const group = project.sectionPackManager.packEntityToSection([member])!;

    expect(neighbor.rectangle.left).toBeGreaterThan(before);
    expect(sibling.rectangle.left - group.rectangle.right).toBeCloseTo(Section.outerMargin);
  });

  it("keeps a gap between a new group and a nearby sibling node", () => {
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "Member" });
    const neighbor = new TextNode(project, { text: "Neighbor" });
    neighbor.moveTo(new Vector(member.rectangle.right + Section.contentPadding + 5, 0));
    project.stage.push(member, neighbor);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);

    const group = project.sectionPackManager.packEntityToSection([member])!;

    expect(group.rectangle.right - member.rectangle.right).toBeCloseTo(Section.contentPadding);
    expect(neighbor.rectangle.left - group.rectangle.right).toBeCloseTo(Section.outerMargin);
  });

  it("checks the resized parent group when creating a nested group", () => {
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "member" });
    const parent = new Section(project, { text: "parent", children: [member] });
    const neighbor = new TextNode(project, { text: "neighbor" });
    const before = new Vector(0, parent.rectangle.top - neighbor.rectangle.height - 10);
    neighbor.moveTo(before);
    project.stage.push(parent, member, neighbor);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);

    const group = project.sectionPackManager.packEntityToSection([member])!;

    expect(group.parentSection).toBe(parent);
    expect(member.rectangle.location).toEqual(Vector.getZero());
    expect(neighbor.rectangle.top).toBeLessThan(before.y);
    expect(parent.rectangle.isCollideWith(neighbor.rectangle)).toBe(false);
  });

  it.each([true, false])("checks the expanded ancestor after adding a node to a nested group (%s)", (enabled) => {
    Settings.isEnableEntityCollision = enabled;
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "member" });
    const inner = new Section(project, { children: [member] });
    const outer = new Section(project, { children: [inner] });
    const neighbor = new TextNode(project, { text: "neighbor" });
    const before = new Vector(outer.rectangle.right + 10, 0);
    neighbor.moveTo(before);
    project.stage.push(member, inner, outer, neighbor);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);

    const uuid = new NodeAdder(project).addConnectPoint(new Vector(inner.rectangle.right - 1, 10), [outer, inner]);

    expect(project.stageManager.get(uuid)).toBe(inner.children[1]);
    expect(outer.rectangle.isCollideWith(neighbor.rectangle)).toBe(!enabled);
    if (enabled) expect(neighbor.rectangle.left).toBeGreaterThan(before.x);
    else expect(neighbor.rectangle.location).toEqual(before);
    project.historyManager.undo();
    expect(project.stageManager.get(uuid)).toBeUndefined();
    expect(project.stageManager.get(neighbor.uuid)?.collisionBox.getRectangle().location).toEqual(before);
  });

  it("separates a sibling group fully covered by an expanded group with group-only collision", () => {
    Settings.isEnableEntityCollision = false;
    Settings.isEnableSectionCollision = true;
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "member" });
    const added = new TextNode(project, { text: "added" });
    const neighbor = new TextNode(project, { text: "neighbor" });
    added.moveTo(new Vector(600, 300));
    const before = new Vector(300, 120);
    neighbor.moveTo(before);
    const group = new Section(project, { children: [member] });
    const sibling = new Section(project, { children: [neighbor] });
    project.stage.push(group, member, sibling, neighbor, added);
    project.stageManager.updateReferences();
    const expandedBounds = Rectangle.getBoundingRectangle([member.rectangle, added.rectangle], 30);
    expect(sibling.rectangle.isAbsoluteIn(expandedBounds)).toBe(true);

    project.sectionInOutManager.goInSection([added], group);

    expect(added.parentSection).toBe(group);
    expect(group.rectangle.isCollideWith(sibling.rectangle)).toBe(false);
    expect(neighbor.rectangle.location).not.toEqual(before);
  });

  it("checks the final bounds when a node changes groups and moves into place", () => {
    const project = createProjectWithHistory();
    const member = new TextNode(project, { text: "member" });
    const arriving = new TextNode(project, { text: "member" });
    const neighbor = new TextNode(project, { text: "neighbor" });
    const before = new Vector(250, 0);
    neighbor.moveTo(before);
    arriving.moveTo(new Vector(500, 0));
    const group = new Section(project, { children: [member] });
    project.stage.push(group, member, arriving, neighbor);
    project.stageManager.updateReferences();

    project.sectionInOutManager.goInSection([arriving], group, () => {
      expect(group.rectangle.isCollideWith(neighbor.rectangle)).toBe(true);
      arriving.moveTo(member.rectangle.location);
    });

    expect(group.rectangle.isCollideWith(neighbor.rectangle)).toBe(false);
    expect(neighbor.rectangle.location).toEqual(before);
  });

  it("checks the final bounds of a group created from a selection rectangle", () => {
    const project = createProjectWithHistory();
    const rectangle = new Rectangle(new Vector(100, 100), new Vector(100, 100));
    const shutDown = vi.fn();
    project.rectangleSelect = { getRectangle: () => rectangle, shutDown } as unknown as Project["rectangleSelect"];
    const neighbor = new TextNode(project, { text: "neighbor" });
    neighbor.moveTo(new Vector(215, 130));
    project.stage.push(neighbor);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);

    const group = project.sectionPackManager.createSectionFromSelectionRectangle()!;

    expect(group.children).toHaveLength(2);
    expect(neighbor.rectangle.left).toBeGreaterThan(215);
    expect(group.rectangle.isCollideWith(neighbor.rectangle)).toBe(false);
    expect(shutDown).toHaveBeenCalledOnce();
  });
});

it("deletes a selected node and a separately selected edge in one step", () => {
  const project = createProjectWithHistory();
  const [first, second, third] = ["a", "b", "c"].map((text) => new TextNode(project, { text }));
  const attached = LineEdge.fromTwoEntity(project, first, second);
  const separate = LineEdge.fromTwoEntity(project, second, third);
  first.isSelected = true;
  separate.isSelected = true;
  project.stage.push(first, second, third, attached, separate);
  project.historyManager = new HistoryManager(project);

  project.stageManager.deleteSelectedStageObjects();
  expect(project.stage).toEqual([second, third]);
  project.historyManager.undo();
  expect(project.stage.map((object) => object.uuid)).toEqual([
    first.uuid,
    second.uuid,
    third.uuid,
    attached.uuid,
    separate.uuid,
  ]);
  expect(project.historyManager.canUndo).toBe(false);
  project.historyManager.redo();
  expect(project.stage.map((object) => object.uuid)).toEqual([second.uuid, third.uuid]);
});

describe("StageManager.updateReferences", () => {
  it("replaces unknown edge endpoints with the real entities on stage", () => {
    const source = textNode("source-uuid", 0, 0);
    const target = textNode("target-uuid", 300, 0);
    const edge = lineEdge([unknownEntity("source-uuid"), unknownEntity("target-uuid")]);
    const manager = createStageManager([source, target, edge]);

    manager.updateReferences();

    expect(edge.source).toBe(source);
    expect(edge.target).toBe(target);
    expect(edge.source.unknown).toBe(false);
  });

  it("only replaces the endpoint that is still unknown", () => {
    const source = textNode("source-uuid");
    const edge = lineEdge([source, unknownEntity("target-uuid")]);
    const target = textNode("target-uuid");
    const manager = createStageManager([source, target, edge]);

    manager.updateReferences();

    expect(edge.source).toBe(source);
    expect(edge.target).toBe(target);
  });

  it("keeps unknown endpoints whose uuid is not on stage", () => {
    const edge = lineEdge([unknownEntity("source-uuid"), unknownEntity("missing-uuid")]);
    const manager = createStageManager([textNode("source-uuid"), edge]);

    manager.updateReferences();

    expect(edge.source.unknown).toBe(false);
    expect(edge.target.unknown).toBe(true);
  });

  it("does not resolve endpoints against entities that cannot be connected", () => {
    // PenStroke 是 Entity 但不是 ConnectableEntity，不能作为 Edge 端点
    const penStroke = Object.assign(Object.create(PenStroke.prototype), {
      uuid: "pen-uuid",
      collisionBox: new CollisionBox([new Rectangle(new Vector(0, 0), new Vector(100, 80))]),
    }) as PenStroke;
    const edge = lineEdge([unknownEntity("pen-uuid"), unknownEntity("other-uuid")]);
    const manager = createStageManager([penStroke, edge]);

    manager.updateReferences();

    expect(edge.source.unknown).toBe(true);
  });

  it("rebuilds the section runtime tree", () => {
    const node = textNode("node-uuid", 10, 10);
    const sectionObject = section("section-uuid", [node]);
    const manager = createStageManager([sectionObject, node]);

    manager.updateReferences();

    expect(sectionObject.children).toEqual([node]);
    expect(node.parentSection).toBe(sectionObject);
    expect(manager.getRootSections()).toEqual([sectionObject]);
    expect(manager.getTopLevelEntities()).toEqual([sectionObject]);
    expect(node.sectionDepth).toBe(1);
  });

  it("assigns symmetric shifting indexes to multi-edges of the same geometry group", () => {
    const source = textNode("a", 0, 0);
    const target = textNode("b", 300, 0);
    const first = lineEdge([source, target], "11111111-1111-1111-1111-111111111111");
    const second = lineEdge([target, source], "22222222-2222-2222-2222-222222222222");
    const selfLoop = lineEdge([source, source], "33333333-3333-3333-3333-333333333333");
    const manager = createStageManager([source, target, first, second, selfLoop]);

    manager.updateReferences();

    expect([first.shiftingIndex, second.shiftingIndex].sort()).toEqual([-1, 1]);
    expect(selfLoop.shiftingIndex).toBe(0);
  });

  it("preserves distinct ports for parallel edges and resumes automatic sides when only one remains", () => {
    const source = textNode("a");
    const target = textNode("b", -300);
    const first = lineEdge([source, target]);
    first.sourceRectangleRate = new Vector(0.99, 0.5);
    first.targetRectangleRate = new Vector(0.01, 0.5);
    const second = lineEdge([target, source]);
    const stage = [source, target, first, second];
    const manager = createStageManager(stage);

    manager.updateReferences();
    expect(first.shiftingIndex).toBe(0);
    expect(first.bodyLine.start).toEqual(new Vector(100, 40));
    expect(second.bodyLine.end).toEqual(new Vector(0, 40));

    stage.pop();
    manager.updateReferences();
    expect(first.bodyLine.start).toEqual(new Vector(0, 40));
  });

  it("pins manually chosen sides and restores automatic anchoring when both are reset", () => {
    const source = textNode("a");
    const target = textNode("b", -300);
    const edge = lineEdge([source, target]);
    const manager = createStageManager([source, target, edge]);

    manager.changeEdgesConnectLocation([edge], Direction.Right, true);
    manager.changeEdgesConnectLocation([edge], Direction.Left);
    expect(edge.bodyLine.start).toEqual(new Vector(100, 40));
    expect(edge.bodyLine.end).toEqual(new Vector(-300, 40));

    manager.changeEdgesConnectLocation([edge], null, true);
    manager.changeEdgesConnectLocation([edge], null);
    expect(edge.fixedEndpoints).toBeUndefined();
    expect(edge.bodyLine.start).toEqual(new Vector(0, 40));
    expect(edge.bodyLine.end).toEqual(new Vector(-200, 40));
  });

  it("scans the association list once regardless of entity count", () => {
    // 回归护栏：修复前每个实体都会触发一次全量关系扫描，调用次数随实体数线性增长（O(N*E)）
    const stage: object[] = [];
    for (let i = 0; i < 200; i++) {
      const node = textNode(`node-${i}`, i, 0);
      stage.push(node, lineEdge([node, node]));
    }
    const manager = createStageManager(stage);
    const associationsSpy = vi.spyOn(StageManager.prototype, "getAssociations");

    manager.updateReferences();

    expect(associationsSpy).toHaveBeenCalledOnce();
    associationsSpy.mockRestore();
  });
});
