import { Vector } from "@graphif/data-structures";
import { Rectangle, SymmetryCurve } from "@graphif/shapes";

type Links = ReadonlyMap<string, ReadonlySet<string>>;
type Rectangles = ReadonlyMap<string, Rectangle>;
type MindMapFootprints = ReadonlyMap<string, { width: number; height: number }>;

export type MindMapBranch = { parentId: string; side: number };

export const mindMapSpacing = { branches: 62, verticalLevels: 255, horizontalLevels: 315, groups: 94 };

export function mindMapDepthScale(depth: number) {
  return Math.max(0.58, 0.88 ** depth);
}

export function approachesMindMapLeafVertically(horizontalOffset: number, verticalGap: number) {
  return verticalGap > 0 && Math.abs(horizontalOffset) <= verticalGap * 0.75;
}

export function getMindMapSiblingRows(siblings: string[], rectangles: Rectangles, sections: ReadonlySet<string>) {
  if (siblings.length < 2 || !siblings.some((id) => sections.has(id))) return [siblings];
  const areas = new Map(
    siblings.map((id) => {
      const { width, height } = rectangles.get(id)!;
      return [id, width * height];
    }),
  );
  const sorted = [...areas.values()].sort((a, b) => a - b);
  // 同级有多个大框时，仍以较小分支的面积作为靠内的基准。
  const referenceArea = Math.max(1, sorted[Math.floor((sorted.length - 1) / 4)]);
  const rows = new Map<number, string[]>();
  for (const id of siblings) {
    const row = sections.has(id) ? Math.max(0, Math.floor(Math.log2(areas.get(id)! / referenceArea))) : 0;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push(id);
  }
  return [...rows.keys()].sort((a, b) => a - b).map((row) => rows.get(row)!);
}

export function packMindMapSiblingRows(rows: string[][], footprints: MindMapFootprints, gap: number) {
  const offsets = new Map<string, Vector>();
  const widthOf = (ids: string[]) =>
    ids.reduce((width, id) => width + footprints.get(id)!.width, 0) + Math.max(0, ids.length - 1) * gap;
  let width = 0;
  let height = 0;
  for (const [index, row] of rows.entries()) {
    let rowHeight = 0;
    const place = (ids: string[], left: number) => {
      for (const id of ids) {
        const footprint = footprints.get(id)!;
        offsets.set(id, new Vector(left + footprint.width / 2, height));
        left += footprint.width + gap;
        rowHeight = Math.max(rowHeight, footprint.height);
      }
    };
    if (index < rows.length - 1) {
      // 给通往外侧大分组的连线留出中间的通道。
      const first = row.slice(0, Math.ceil(row.length / 2));
      const second = row.slice(first.length);
      const leftWidth = widthOf(first);
      const rightWidth = widthOf(second);
      place(first, -leftWidth - gap / 2);
      place(second, gap / 2);
      width = Math.max(width, 2 * Math.max(leftWidth, rightWidth) + gap);
      height += rowHeight + gap;
    } else {
      const rowWidth = widthOf(row);
      place(row, -rowWidth / 2);
      width = Math.max(width, rowWidth);
      height += rowHeight;
    }
  }
  return { width, height, offsets };
}

export function layoutVerticalMindMap(
  rootId: string,
  roots: string[],
  ordered: string[],
  children: ReadonlyMap<string, string[]>,
  rectangles: Rectangles,
  sections: ReadonlySet<string>,
  sign: number,
  placements: Map<string, Rectangle>,
  fanParents: Map<string, MindMapBranch>,
  depthOffset: number,
) {
  // 枝条错落的幅度独立于节点间距，避免加宽间距时把深枝推得过远。
  const fanStep = 32;
  const depthGap = mindMapSpacing.verticalLevels;
  const layouts = new Map<string, { width: number; height: number; levels: number; offsets: Map<string, Vector> }>();
  const nodes = [rootId, ...ordered];
  const depths = new Map([[rootId, depthOffset]]);
  for (const id of nodes) {
    for (const child of id === rootId ? roots : children.get(id)!) depths.set(child, depths.get(id)! + 1);
  }
  for (const id of [...nodes].reverse()) {
    const rectangle = rectangles.get(id)!;
    const siblings = id === rootId ? roots : children.get(id)!;
    const gap = mindMapSpacing.branches * mindMapDepthScale(depths.get(id)!);
    const offsets = new Map<string, Vector>();
    let width = rectangle.width;
    let height = rectangle.height;
    const levels = siblings.reduce((max, child) => Math.max(max, layouts.get(child)!.levels + 1), 0);
    const rows = getMindMapSiblingRows(siblings, rectangles, sections);
    if (siblings.length >= 5 && rows.length === 1) {
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
          let verticalEntry =
            childLayout.levels === 0 && approachesMindMapLeafVertically(center, offset.y - rectangle.height);
          if (verticalEntry) {
            const curve = new SymmetryCurve(origin, away, new Vector(center, offset.y), new Vector(0, -1));
            verticalEntry = !occupied.some((bounds) => curve.isCollideWithRectangle(bounds));
          }
          fanParents.set(child, { parentId: id, side: verticalEntry ? 0 : side });
          occupied.push(
            new Rectangle(
              new Vector(center - childLayout.width / 2, offset.y),
              new Vector(childLayout.width, childLayout.height),
            ).expandFromCenter(8),
          );
          offset.x = side * center;
          width = Math.max(width, 2 * center + childLayout.width);
        }
      }
      offsets.set(leader, new Vector(0, leaderDepth));
      fanParents.set(leader, { parentId: id, side: 0 });
      width = Math.max(width, leaderLayout.width);
      height = leaderDepth + leaderLayout.height;
    } else if (siblings.length) {
      const packed = packMindMapSiblingRows(rows, layouts, gap);
      height += depthGap + packed.height;
      width = Math.max(width, packed.width);
      for (const [child, offset] of packed.offsets) {
        offsets.set(child, new Vector(offset.x, rectangle.height + depthGap + offset.y));
      }
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
