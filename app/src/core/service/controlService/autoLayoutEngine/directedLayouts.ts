import { Vector } from "@graphif/data-structures";
import { Rectangle, SymmetryCurve } from "@graphif/shapes";

type Links = ReadonlyMap<string, ReadonlySet<string>>;
type Rectangles = ReadonlyMap<string, Rectangle>;

export type MindMapBranch = { parentId: string; side: number };

export const mindMapSpacing = { branches: 62, verticalLevels: 150, horizontalLevels: 186, groups: 94 };

export function layoutVerticalMindMap(
  rootId: string,
  roots: string[],
  ordered: string[],
  children: ReadonlyMap<string, string[]>,
  rectangles: Rectangles,
  sign: number,
  placements: Map<string, Rectangle>,
  fanParents: Map<string, MindMapBranch>,
) {
  const { branches: gap, verticalLevels: depthGap } = mindMapSpacing;
  // 枝条错落的幅度独立于节点间距，避免加宽间距时把深枝推得过远。
  const fanStep = 32;
  const layouts = new Map<string, { width: number; height: number; levels: number; offsets: Map<string, Vector> }>();
  const nodes = [rootId, ...ordered];
  for (const id of [...nodes].reverse()) {
    const rectangle = rectangles.get(id)!;
    const siblings = id === rootId ? roots : children.get(id)!;
    const offsets = new Map<string, Vector>();
    let width = rectangle.width;
    let height = rectangle.height;
    const levels = siblings.reduce((max, child) => Math.max(max, layouts.get(child)!.levels + 1), 0);
    if (siblings.length >= 5) {
      const middle = Math.floor(siblings.length / 2);
      const leader = siblings[middle];
      const leaderLayout = layouts.get(leader)!;
      let leaderDepth = rectangle.height + depthGap;
      for (const side of [-1, 1]) {
        const branches = side < 0 ? siblings.slice(0, middle) : siblings.slice(middle + 1).reverse();
        // 伸出的枝条可能超过较低叶片的横坐标，按生长方向排序才能让重复布局保持稳定。
        branches.sort((a, b) => sign * (rectangles.get(a)!.center.y - rectangles.get(b)!.center.y));
        // 两侧分别沿生长方向排布，较深的子树只会占用所在一侧的空间。
        let depth = rectangle.height + depthGap + (side > 0 ? fanStep / 2 : 0);
        for (const [index, child] of branches.entries()) {
          const childLayout = layouts.get(child)!;
          depth += Math.min(3, childLayout.levels) * fanStep;
          offsets.set(child, new Vector(0, depth));
          const rhythm = ((index + (side > 0 ? 1 : 0)) % 3) - 1;
          const spacing = gap + fanStep * (Math.max(0.5, 1.5 - index / branches.length + rhythm * 0.8) - 1);
          depth += childLayout.height + spacing;
        }
        leaderDepth = Math.max(leaderDepth, depth);

        let inner = rectangle.width / 2 + gap;
        let previousCenter = 0;
        for (const child of [...branches].reverse()) {
          const childLayout = layouts.get(child)!;
          const childRect = rectangles.get(child)!;
          const halfWidth = childLayout.width / 2;
          const center = Math.max(inner + halfWidth, previousCenter + gap);
          offsets.get(child)!.x = center;
          // 为更靠里的枝条留出走线空间，弧线不会经过外层标签。
          inner = center - childRect.width / 2 + gap;
          previousCenter = center;
        }

        const occupied: Rectangle[] = [];
        const origin = new Vector(0, rectangle.height);
        const away = new Vector(0, 1);
        const inward = new Vector(-1, 0);
        for (const [index, child] of branches.entries()) {
          const childLayout = layouts.get(child)!;
          const childRect = rectangles.get(child)!;
          const offset = offsets.get(child)!;
          const spread = childLayout.levels
            ? Math.min(16, 8 + 3 * childLayout.levels) * fanStep
            : (index % 3 === (side < 0 ? 1 : 2) ? 4 : 0) * fanStep;
          let center = offset.x + spread;
          // 只收回有遮挡的分支，避免深枝把同侧其他叶片一起推远。
          for (; center > offset.x; center -= fanStep) {
            const entry = new Vector(center - childRect.width / 2, offset.y + childRect.height / 2);
            const curve = new SymmetryCurve(origin, away, entry, inward);
            if (!occupied.some((bounds) => entry.x >= bounds.left && curve.isCollideWithRectangle(bounds))) break;
          }
          occupied.push(
            new Rectangle(
              new Vector(center - childLayout.width / 2, offset.y),
              new Vector(childLayout.width, childLayout.height),
            ).expandFromCenter(8),
          );
          offset.x = side * center;
          fanParents.set(child, { parentId: id, side });
          width = Math.max(width, 2 * center + childLayout.width);
        }
      }
      offsets.set(leader, new Vector(0, leaderDepth));
      fanParents.set(leader, { parentId: id, side: 0 });
      width = Math.max(width, leaderLayout.width);
      height = leaderDepth + leaderLayout.height;
    } else if (siblings.length) {
      const rowWidth =
        siblings.reduce((sum, child) => sum + layouts.get(child)!.width, 0) + (siblings.length - 1) * gap;
      let left = -rowWidth / 2;
      for (const child of siblings) {
        const size = layouts.get(child)!;
        offsets.set(child, new Vector(left + size.width / 2, rectangle.height + depthGap));
        left += size.width + gap;
        height = Math.max(height, rectangle.height + depthGap + size.height);
      }
      width = Math.max(width, rowWidth);
    }
    layouts.set(id, { width, height, levels, offsets });
  }

  for (const id of nodes) {
    const parent = placements.get(id)!;
    for (const [child, offset] of layouts.get(id)!.offsets) {
      const rectangle = rectangles.get(child)!;
      const x = parent.center.x + offset.x - rectangle.width / 2;
      const y = sign > 0 ? parent.top + offset.y : parent.bottom - offset.y - rectangle.height;
      placements.set(child, new Rectangle(new Vector(x, y), rectangle.size));
    }
  }
}

function getDirectedOrder(rectangles: Rectangles, incoming: Links): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  for (const id of [...rectangles.keys()].sort()) {
    const pending = [{ id, expanded: false }];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.expanded) {
        order.push(node.id);
      } else if (!visited.has(node.id)) {
        visited.add(node.id);
        pending.push({ id: node.id, expanded: true });
        for (const previous of [...incoming.get(node.id)!].reverse()) {
          if (!visited.has(previous)) pending.push({ id: previous, expanded: false });
        }
      }
    }
  }
  return order;
}

function getFishboneSpine(rectangles: Rectangles, incoming: Links, outgoing: Links): string[] {
  const order = getDirectedOrder(rectangles, incoming);
  const paths = new Map<string, { length: number; previous?: string }>();
  for (const id of order) {
    let best: { length: number; previous?: string } = { length: 0 };
    for (const previous of incoming.get(id)!) {
      const path = paths.get(previous);
      if (path && path.length + 1 > best.length) best = { length: path.length + 1, previous };
    }
    paths.set(id, best);
  }
  const sinks = order.filter((id) => outgoing.get(id)!.size === 0);
  const head = (sinks.length > 0 ? sinks : order).reduce((best, id) => {
    const distance = paths.get(id)!.length - paths.get(best)!.length;
    return distance > 0 || (distance === 0 && incoming.get(id)!.size > incoming.get(best)!.size) ? id : best;
  });
  const spine: string[] = [];
  for (let id: string | undefined = head; id !== undefined; id = paths.get(id)!.previous) spine.push(id);
  return spine.reverse();
}

function layoutRibs(
  roots: string[],
  anchor: Rectangle,
  clearance: number,
  forward: boolean,
  above: boolean,
  rectangles: Rectangles,
  children: ReadonlyMap<string, string[]>,
  outgoing: Links,
) {
  const offset = (id: string) => rectangles.get(id)!.center.subtract(anchor.center);
  roots.sort((a, b) => {
    const first = offset(a);
    const second = offset(b);
    return Math.abs(first.y) - Math.abs(second.y) || Math.abs(first.x) - Math.abs(second.x);
  });

  const widths = new Map<number, number>();
  const pending = roots.map((id) => ({ id, column: 0 })).reverse();
  const ordered: { id: string; column: number }[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    ordered.push(node);
    widths.set(node.column, Math.max(widths.get(node.column) ?? 0, rectangles.get(node.id)!.width));
    for (const child of [...children.get(node.id)!].reverse()) {
      const step = outgoing.get(node.id)!.has(child) ? 1 : -1;
      pending.push({ id: child, column: node.column + step });
    }
  }

  const offsets = new Map<number, number>();
  const columnGap = 120;
  let x = 0;
  for (const [column, width] of [...widths].sort(([a], [b]) => a - b)) {
    offsets.set(column, forward ? x : x + width);
    x += width + columnGap;
  }

  const placements = new Map<string, Rectangle>();
  let distance = clearance;
  for (const { id, column } of ordered) {
    const rect = rectangles.get(id)!;
    const left = offsets.get(column)! - (forward ? 0 : rect.width);
    const top = above ? -distance - rect.height : distance;
    placements.set(id, new Rectangle(new Vector(left, top), rect.size));
    distance += rect.height + 40;
  }
  return { placements, width: Math.max(0, x - columnGap) };
}

export function layoutFishbone(rectangles: Rectangles, incoming: Links, outgoing: Links): Map<string, Rectangle> {
  const spine = getFishboneSpine(rectangles, incoming, outgoing);
  const children = new Map([...rectangles.keys()].map((id) => [id, [] as string[]]));
  const pending = [...spine];
  const visited = new Set(pending);
  const attach = (id: string, neighbors: Iterable<string>) => {
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      children.get(id)!.push(neighbor);
      pending.push(neighbor);
    }
  };
  // 从主轴向外逐层归类，避免交叉连线把直接相邻的分支挂到更远的节点。
  for (const id of pending) {
    attach(id, incoming.get(id)!);
    attach(id, outgoing.get(id)!);
  }

  const head = spine.at(-1)!;
  const headRect = rectangles.get(head)!;
  const y = headRect.center.y;
  const halfHeight = spine.reduce((height, id) => Math.max(height, rectangles.get(id)!.height / 2), 0);
  const placements = new Map<string, Rectangle>();
  let x = 0;
  const gap = 120;
  let above = false;
  for (const id of spine) {
    const rect = rectangles.get(id)!;
    const branches = children.get(id)!;
    const placeRibs = (forward: boolean) => {
      const roots = branches.filter((child) => outgoing.get(id)!.has(child) === forward);
      if (!roots.length) return;
      const ribs = layoutRibs(roots, rect, halfHeight + 72, forward, above, rectangles, children, outgoing);
      const horizontalGap = roots.reduce(
        (run, child) => Math.max(run, Math.abs(ribs.placements.get(child)!.center.y)),
        gap,
      );
      if (forward) x += horizontalGap;
      for (const [node, rib] of ribs.placements) {
        placements.set(node, new Rectangle(rib.location.add(new Vector(x, y)), rib.size));
      }
      x += ribs.width;
      if (!forward) x += horizontalGap;
    };
    placeRibs(false);
    placements.set(id, new Rectangle(new Vector(x, y - rect.height / 2), rect.size));
    x += rect.width;
    placeRibs(true);
    x += gap;
    if (branches.length) above = !above;
  }

  const shift = new Vector(headRect.left - placements.get(head)!.left, 0);
  for (const rect of placements.values()) rect.location = rect.location.add(shift);
  placements.set(head, headRect);
  return placements;
}
