import { describe, expect, it, vi } from "vitest";
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
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: {} }));
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
import { SectionInOutManager } from "./concreteMethods/StageSectionInOutManager";
import { SectionPackManager } from "./concreteMethods/StageSectionPackManager";
import { Direction } from "@/types/directions";
import { HistoryManager } from "./StageHistoryManager";
import { NodeConnector } from "./concreteMethods/StageNodeConnector";
import { SectionMethods } from "./basicMethods/SectionMethods";
import { GraphMethods } from "./basicMethods/GraphMethods";
import { ConnectNodeSmartTools } from "@/core/service/dataManageService/connectNodeSmartTools";
import { ArcEdge } from "@/core/stage/stageObject/association/ArcEdge";

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
  [Direction.Up, "bottom"],
  [Direction.Right, undefined],
  [Direction.Down, undefined],
] as const)(
  "places a newly named node clear of its source and keeps the gap while editing in direction %s",
  async (direction, resizeAnchor) => {
    const source = textNode("source", 200, 200);
    source.isSelected = true;
    const add = vi.fn();
    const project = {
      stageManager: { getSelectedEntities: () => [source], getTextNodes: () => [source], add },
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
    expect(gap()).toBe(48);
    expect(project.historyManager.recordStep).toHaveBeenCalledOnce();

    node.rename("An even wider title than the original one\nwith a second line", resizeAnchor);
    expect(gap()).toBe(48);
  },
);

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
    emit: vi.fn(),
    effects: { addEffect: vi.fn(), addEffects: vi.fn() },
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
  return project;
}

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
