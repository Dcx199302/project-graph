import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

type Links = ReadonlyMap<string, ReadonlySet<string>>;
type Rectangles = ReadonlyMap<string, Rectangle>;

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
