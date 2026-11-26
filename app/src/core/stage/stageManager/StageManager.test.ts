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
  it("toggles between the union of the selected nodes' connected groups and the entire canvas", () => {
    const a = textNode("a");
    const b = textNode("b");
    const c = textNode("c");
    const d = textNode("d");
    const e = textNode("e");
    const f = textNode("f");
    const isolated = textNode("isolated");
    const manager = createStageManager([
      a,
      b,
      c,
      d,
      e,
      f,
      isolated,
      lineEdge([b, a]),
      lineEdge([b, c]),
      lineEdge([c, a]),
      new MultiTargetUndirectedEdge({} as Project, { associationList: [d, e, f] }),
    ]);
    a.isSelected = d.isSelected = true;
    const related = [a, b, c, d, e, f];

    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual(related);
    expect(manager.selectAll()).toBe("global");
    expect(manager.getStageObjects().every((object) => object.isSelected)).toBe(true);
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual(related);
    expect(manager.selectAll()).toBe("global");
  });

  it("clears the saved group when the selection is cleared", () => {
    const a = textNode("a");
    const b = textNode("b");
    const c = textNode("c");
    const d = textNode("d");
    const manager = createStageManager([a, b, c, d, lineEdge([a, b]), lineEdge([c, d])]);
    a.isSelected = true;
    manager.selectAll();

    manager.clearSelectAll();
    a.isSelected = b.isSelected = true;
    expect(manager.selectAll()).toBe("local");
    expect(manager.selectAll()).toBe("global");

    manager.clearSelectAll();
    expect(manager.getSelectedStageObjects()).toEqual([]);
    expect(manager.selectAll()).toBe("global");
    expect(manager.selectAll()).toBe("global");

    manager.clearSelectAll();
    d.isSelected = true;
    expect(manager.selectAll()).toBe("local");
    expect(manager.getSelectedStageObjects()).toEqual([c, d]);
  });

  it("selects the entire canvas when a selected node has no other connected nodes", () => {
    const isolated = textNode("isolated");
    const unrelated = textNode("unrelated");
    const loop = lineEdge([isolated, isolated]);
    const manager = createStageManager([isolated, unrelated, loop]);
    isolated.isSelected = true;

    expect(manager.selectAll()).toBe("global");
    expect(manager.getSelectedStageObjects()).toEqual([isolated, unrelated, loop]);
    expect(manager.selectAll()).toBe("global");
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
    expect(distance).toBe(gap);
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
    const before = member.rectangle.right + 40;
    neighbor.moveTo(new Vector(before, 0));
    const sibling = new Section(project, { text: "sibling", children: [neighbor] });
    project.stage.push(member, neighbor, sibling);
    project.stageManager.updateReferences();
    project.historyManager = new HistoryManager(project);

    const group = project.sectionPackManager.packEntityToSection([member])!;

    expect(neighbor.rectangle.left).toBeGreaterThan(before);
    expect(group.rectangle.isCollideWith(sibling.rectangle)).toBe(false);
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
