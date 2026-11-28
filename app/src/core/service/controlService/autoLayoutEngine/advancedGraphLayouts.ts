import { Vector } from "@graphif/data-structures";
import type { Rectangle } from "@graphif/shapes";
import { flextree, type FlextreeNode } from "d3-flextree";

type LayoutEdge = { source: string; target: string };
type Rectangles = ReadonlyMap<string, Rectangle>;

const branchGap = 48;
const tidyTreeLevelGap = 150;

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

export function computeTidyTreeLayout(
  rectangles: Rectangles,
  edges: readonly LayoutEdge[],
  fontScaleLevels?: ReadonlyMap<string, number>,
): Map<string, Vector> | undefined {
  const tree = getTree(rectangles, edges);
  if (!tree) return;
  const layout = flextree<string>({
    nodeSize: ({ data }) => {
      const rectangle = rectangles.get(data)!;
      const fontScale = 2 ** ((fontScaleLevels?.get(data) ?? 0) / 2);
      return [rectangle.height, rectangle.width + tidyTreeLevelGap * fontScale];
    },
    spacing: branchGap,
  });
  const positions = new Map(
    layout(tree)
      .descendants()
      .map(({ data, x, y }) => [data, new Vector(y, x - rectangles.get(data)!.height / 2)]),
  );
  if (positions.size !== rectangles.size || [...positions.values()].some(({ x, y }) => !Number.isFinite(x + y))) {
    throw new Error("自动布局未能为所有节点计算有效坐标");
  }
  const offset = rectangles.get(tree.data)!.location.subtract(positions.get(tree.data)!);
  return new Map([...positions].map(([id, location]) => [id, location.add(offset)]));
}
