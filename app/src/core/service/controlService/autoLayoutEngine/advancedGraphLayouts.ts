import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { flextree, type FlextreeNode } from "d3-flextree";

export type AdvancedGraphLayout = "tidyTree" | "radialTree" | "layered";
type LayoutEdge = { source: string; target: string };
type Rectangles = ReadonlyMap<string, Rectangle>;

const branchGap = 48;
const levelGap = 100;

const tidyTree = flextree<string>({});

function getTree(rectangles: Rectangles, edges: readonly LayoutEdge[]): FlextreeNode<string> | undefined {
  const children = new Map([...rectangles.keys()].map((id) => [id, [] as string[]]));
  const hasParent = new Set<string>();
  for (const { source, target } of edges) {
    if (hasParent.has(target)) return;
    hasParent.add(target);
    children.get(source)!.push(target);
  }
  const roots = [...rectangles.keys()].filter((id) => !hasParent.has(id));
  if (roots.length !== 1) return;
  const tree = tidyTree.hierarchy(roots[0], (id) => children.get(id));
  if (tree.descendants().length === rectangles.size) return tree;
}

function radialTreePositions(tree: FlextreeNode<string>, rectangles: Rectangles): Map<string, Vector> {
  const weights = new Map<string, number>();
  tree.eachAfter(({ data, children }) =>
    weights.set(data, children?.reduce((weight, child) => weight + weights.get(child.data)!, 0) ?? 1),
  );
  const turn = 2 * Math.PI;
  const starts = new Map([[tree.data, -Math.PI / 2]]);
  const rings: { id: string; angle: number; radius: number }[][] = [];
  tree.eachBefore(({ data, depth, children }) => {
    let start = starts.get(data)!;
    const span = (weights.get(data)! / weights.get(tree.data)!) * turn;
    const rectangle = rectangles.get(data)!;
    (rings[depth] ??= []).push({
      id: data,
      angle: start + span / 2,
      radius: Math.hypot(rectangle.width, rectangle.height) / 2,
    });
    for (const child of children ?? []) {
      starts.set(child.data, start);
      start += (weights.get(child.data)! / weights.get(tree.data)!) * turn;
    }
  });

  let distance = 0;
  let previousRadius = 0;
  const positions = new Map<string, Vector>();
  for (const [depth, ring] of rings.entries()) {
    const radius = ring.reduce((max, node) => Math.max(max, node.radius), 0);
    let angleGap = turn;
    for (const [index, { angle }] of ring.entries()) {
      const nextAngle = ring[index + 1]?.angle ?? ring[0].angle + turn;
      angleGap = Math.min(angleGap, nextAngle - angle);
    }
    if (depth > 0) {
      distance += previousRadius + radius + branchGap;
      // 用外接圆的弦长给同一圈的矩形留出间距。
      if (ring.length > 1) distance = Math.max(distance, (radius * 2 + branchGap) / (2 * Math.sin(angleGap / 2)));
    }
    for (const { id, angle } of ring) {
      const center = new Vector(Math.cos(angle) * distance, Math.sin(angle) * distance);
      positions.set(id, center.subtract(rectangles.get(id)!.size.divide(2)));
    }
    previousRadius = radius;
  }
  return positions;
}

async function layeredPositions(rectangles: Rectangles, edges: readonly LayoutEdge[]): Promise<Map<string, Vector>> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const { children } = await new ELK().layout({
    id: "layout",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": String(branchGap),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(levelGap),
    },
    children: [...rectangles].map(([id, { width, height }]) => ({ id, width, height })),
    edges: edges.map(({ source, target }, index) => ({ id: `edge-${index}`, sources: [source], targets: [target] })),
  });
  return new Map(children?.map(({ id, x, y }) => [id, new Vector(x!, y!)]));
}

export async function computeAdvancedGraphLayout(
  mode: AdvancedGraphLayout,
  rectangles: Rectangles,
  edges: readonly LayoutEdge[],
): Promise<Map<string, Vector> | undefined> {
  let positions: Map<string, Vector>;
  let anchor: string | undefined;
  if (mode === "tidyTree" || mode === "radialTree") {
    const tree = getTree(rectangles, edges);
    if (!tree) return;
    anchor = tree.data;
    if (mode === "radialTree") {
      positions = radialTreePositions(tree, rectangles);
    } else {
      const layout = flextree<string>({
        nodeSize: ({ data }) => {
          const rectangle = rectangles.get(data)!;
          return [rectangle.height, rectangle.width + levelGap];
        },
        spacing: branchGap,
      });
      positions = new Map(
        layout(tree)
          .descendants()
          .map(({ data, x, y }) => [data, new Vector(y, x - rectangles.get(data)!.height / 2)]),
      );
    }
  } else {
    positions = await layeredPositions(rectangles, edges);
  }
  if (positions.size !== rectangles.size || [...positions.values()].some(({ x, y }) => !Number.isFinite(x + y))) {
    throw new Error("自动布局未能为所有节点计算有效坐标");
  }
  const offset = anchor
    ? rectangles.get(anchor)!.location.subtract(positions.get(anchor)!)
    : Rectangle.getBoundingRectangle([...rectangles.values()]).center.subtract(
        Rectangle.getBoundingRectangle(
          [...positions].map(([id, location]) => new Rectangle(location, rectangles.get(id)!.size)),
        ).center,
      );
  return new Map([...positions].map(([id, location]) => [id, location.add(offset)]));
}
