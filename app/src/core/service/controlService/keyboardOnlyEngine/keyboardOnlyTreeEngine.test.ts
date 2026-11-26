import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import type { PreservedGraphLayout } from "@/core/stage/stageObject/association/Edge";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Direction } from "@/types/directions";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutoLayout } from "../autoLayoutEngine/mainTick";
import { KeyboardOnlyTreeEngine } from "./keyboardOnlyTreeEngine";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({ ConnectableEntity: class {} }));
vi.mock("@/core/stage/stageObject/association/Edge", () => ({
  Edge: class {
    static getNormalVectorByRate() {
      return null;
    }
  },
}));
vi.mock("@/core/stage/stageObject/association/LineEdge", () => ({ LineEdge: class {} }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({
  TextNode: class {
    uuid = crypto.randomUUID();
    fontScaleLevel = 0;
    sizeAdjust = "auto";
    isSelected = false;
    collisionBox: CollisionBox;

    constructor(_project: Project, { collisionBox }: { collisionBox: CollisionBox }) {
      this.collisionBox = collisionBox;
    }

    setFontScaleLevel(level: number) {
      this.fontScaleLevel = level;
    }

    moveTo(location: Vector) {
      (this.collisionBox.shapes[0] as Rectangle).location = location;
    }
  },
}));
vi.mock("@/utils/treeValidation", () => ({ showTreeValidationErrors: vi.fn() }));
vi.mock("../../feedbackService/effectEngine/concrete/LineEffect", () => ({ LineEffect: {} }));
vi.mock("../../feedbackService/effectEngine/concrete/RectangleRenderEffect", () => ({ RectangleRenderEffect: {} }));
vi.mock("../../feedbackService/SoundService", () => ({
  SoundService: { play: { treeGenerateDeepSoundFile: vi.fn(), treeGenerateBroadSoundFile: vi.fn() } },
}));

beforeEach(() => {
  vi.useFakeTimers();
  Settings.autoLayoutWhenTreeGenerate = true;
  Settings.enableTreeGenerateConnectByProbe = false;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function createGraph(graphLayout?: PreservedGraphLayout) {
  const node = (x: number, y: number) =>
    new TextNode({} as Project, {
      collisionBox: new CollisionBox([new Rectangle(new Vector(x, y), new Vector(100, 50))]),
    });
  const root = node(0, 0);
  const jsx = node(400, 0);
  const component = node(900, 0);
  const taxonomy = node(700, -180);
  const obstacle = node(700, -280);
  const nodes = [root, jsx, component, taxonomy, obstacle];
  jsx.isSelected = true;
  const edge = (source: TextNode, target: TextNode, graphLayout?: PreservedGraphLayout) => ({
    source,
    target,
    graphLayout,
    sourceRectangleRate: new Vector(0.99, 0.5),
    targetRectangleRate: new Vector(0.01, 0.5),
    isRightToLeft: () => false,
    isLeftToRight: () => true,
    getTreeDirection: () => Direction.Right,
  });
  const edges = [edge(root, jsx, graphLayout), edge(jsx, component, graphLayout), edge(jsx, taxonomy, graphLayout)];
  const connect = vi.fn((from: TextNode, to: TextNode) => edges.push(edge(from, to)));
  const stageManager = {
    getConnectableEntity: () => nodes,
    getTextNodes: () => nodes,
    getEntities: () => nodes,
    getTopLevelEntities: () => nodes,
    getEdges: () => edges,
    add: (newNode: TextNode) => nodes.push(newNode),
    changeEdgesConnectLocation: vi.fn(),
  };
  const recordStep = vi.fn();
  const fastTree = vi.fn();
  const project = {
    stageManager,
    stageUtils: { replaceAutoNameTemplate: () => "" },
    nodeConnector: { connectConnectableEntity: connect },
    camera: { clearMoveCommander: vi.fn() },
    graphMethods: {
      nodeChildrenArray: (node: TextNode) => edges.filter((edge) => edge.source === node).map((edge) => edge.target),
      getIncomingEdges: (node: TextNode) => edges.filter((edge) => edge.target === node),
      getOutgoingEdges: (node: TextNode) => edges.filter((edge) => edge.source === node),
      getOneStepSuccessorSet: (node: TextNode) =>
        edges.filter((edge) => edge.source === node).map((edge) => edge.target),
      getEdgesBetween: (source: TextNode, target: TextNode) =>
        edges.filter((edge) => edge.source === source && edge.target === target),
      getRoots: () => [root],
      validateTreeStructure: () => ({ isValid: true }),
    },
    historyManager: { recordStep },
    autoAlign: { autoLayoutSelectedFastTreeMode: fastTree },
    effects: { addEffects: vi.fn() },
    edgeRenderer: { getConnectedEffects: vi.fn() },
    controllerUtils: { editTextNode: vi.fn() },
  } as unknown as Project;
  project.autoLayout = new AutoLayout(project);
  return {
    nodes,
    edges,
    jsx,
    taxonomy,
    obstacle,
    stageManager,
    connect,
    recordStep,
    fastTree,
    project,
    engine: new KeyboardOnlyTreeEngine(project),
  };
}

it("adds a child to the existing fishbone rib and avoids obstacles without moving the graph", () => {
  const { nodes, edges, jsx, taxonomy, obstacle, engine, fastTree, recordStep } = createGraph("fishbone");
  const rect = (node: TextNode) => node.collisionBox.getRectangle();
  const positions = nodes.map((node) => rect(node).location);
  engine.generateChildNode("new child");
  const child = nodes.at(-1)!;
  expect(nodes.slice(0, -1).map((node) => rect(node).location)).toEqual(positions);
  expect(rect(child).left).toBe(rect(taxonomy).left);
  expect(rect(child).bottom).toBeLessThan(rect(obstacle).top);
  expect(edges.at(-1)).toMatchObject({ source: jsx, target: child, graphLayout: "fishbone" });
  expect(child.isSelected).toBe(true);
  expect(fastTree).not.toHaveBeenCalled();
  expect(recordStep).toHaveBeenCalledOnce();

  engine.generateChildNode("another child");
  expect(edges.at(-1)).toMatchObject({ source: child, graphLayout: "fishbone" });
  expect(fastTree).not.toHaveBeenCalled();
});

it("still formats ordinary trees when adding a child with automatic layout enabled", () => {
  const { engine, nodes, edges, connect, fastTree, recordStep } = createGraph();
  engine.generateChildNode("new child");
  expect(connect).toHaveBeenCalledOnce();
  expect(edges.at(-1)?.graphLayout).toBeUndefined();
  expect(fastTree).toHaveBeenCalledExactlyOnceWith(nodes[0]);
  expect(recordStep).toHaveBeenCalledOnce();
  expect(fastTree.mock.invocationCallOrder[0]).toBeLessThan(recordStep.mock.invocationCallOrder[0]);
});

it("also skips tree formatting when the growth probe connects to an existing node in a fishbone", () => {
  const { nodes, edges, jsx, obstacle, engine, fastTree, recordStep } = createGraph("fishbone");
  const count = nodes.length;
  Settings.enableTreeGenerateConnectByProbe = true;
  vi.spyOn(engine, "findConnectTargetByGrowthLine").mockReturnValue(obstacle);

  engine.generateChildNode();

  expect(nodes).toHaveLength(count);
  expect(edges.at(-1)).toMatchObject({ source: jsx, target: obstacle, graphLayout: "fishbone" });
  expect(fastTree).not.toHaveBeenCalled();
  expect(recordStep).toHaveBeenCalledOnce();
});

it.each(["dag", "fishbone", "mindMap"] as const)("preserves %s layout when growing a child", (layout) => {
  const { project, nodes, edges, jsx, engine, fastTree, recordStep } = createGraph();
  const selection = nodes.slice(0, -1);
  project.sectionMoveDepth = 0;
  if (layout === "dag") project.autoLayout.autoLayoutDAG(selection);
  else project.autoLayout.autoLayoutGraph(selection, layout);
  const positions = nodes.map((node) => node.collisionBox.getRectangle().location);

  engine.generateChildNode("new child");

  const child = nodes.at(-1)!;
  expect(nodes.slice(0, -1).map((node) => node.collisionBox.getRectangle().location)).toEqual(positions);
  expect(edges.at(-1)).toMatchObject({ source: jsx, target: child, graphLayout: layout });
  if (layout === "dag") {
    const column = nodes[2].collisionBox.getRectangle().left;
    expect(child.collisionBox.getRectangle().left).toBe(column);
  }
  expect(child.isSelected).toBe(true);
  expect(fastTree).not.toHaveBeenCalled();
  expect(recordStep).toHaveBeenCalledTimes(2);
});

it.each([false, true])("adds an unconnected sibling with above=%s", (above) => {
  const { nodes, edges, jsx, project, engine, recordStep } = createGraph();
  edges.length = 0;
  const anchor = jsx.collisionBox.getRectangle();
  expect(engine.canGenerateSiblingNode()).toBe(true);
  engine.generateSiblingNode(above);
  const newNode = nodes.at(-1)!;
  const rect = newNode.collisionBox.getRectangle();
  expect(rect.left).toBe(anchor.left);
  if (above) expect(rect.bottom).toBeLessThan(anchor.top);
  else expect(rect.top).toBeGreaterThan(anchor.bottom);
  expect(edges).toHaveLength(0);
  expect(newNode.isSelected).toBe(true);
  expect(jsx.isSelected).toBe(false);
  expect(recordStep).toHaveBeenCalledOnce();
  vi.runAllTimers();
  expect(project.controllerUtils.editTextNode).toHaveBeenCalledExactlyOnceWith(newNode, true, false);
});

it("adds a sibling above in a directed graph without moving existing nodes or duplicating parents", () => {
  const { nodes, edges, jsx, engine, stageManager, fastTree, recordStep } = createGraph("mindMap");
  const [firstParent, , secondParent] = nodes;
  edges.push({ ...edges[0] }, { ...edges[0], source: secondParent });
  const obstacle = new TextNode({} as Project, {
    collisionBox: new CollisionBox([new Rectangle(new Vector(400, -90), new Vector(100, 60))]),
  });
  stageManager.add(obstacle);
  const positions = nodes.map((node) => node.collisionBox.getRectangle().location);

  engine.generateSiblingNode(true);

  const sibling = nodes.at(-1)!;
  expect(sibling.collisionBox.getRectangle().bottom).toBeLessThan(obstacle.collisionBox.getRectangle().top);
  expect(nodes.slice(0, -1).map((node) => node.collisionBox.getRectangle().location)).toEqual(positions);
  const siblingEdges = edges.filter((edge) => edge.target === sibling);
  expect(siblingEdges.map((edge) => edge.source)).toEqual([firstParent, secondParent]);
  expect(siblingEdges.every((edge) => edge.graphLayout === "mindMap")).toBe(true);
  expect(jsx.isSelected).toBe(false);
  expect(fastTree).not.toHaveBeenCalled();
  expect(recordStep).toHaveBeenCalledOnce();
});
