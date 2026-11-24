import { Project, service } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Edge, type PreservedGraphLayout } from "@/core/stage/stageObject/association/Edge";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import type { Section } from "@/core/stage/stageObject/entity/Section";
import { Direction } from "@/types/directions";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { toast } from "sonner";
import { layoutFishbone } from "./directedLayouts";

export type DAGLayoutResult = {
  movedCount: number;
  internalEdgeCount: number;
};

type MindMapNode = { id: string; rectangle: Rectangle };
type MindMapNeighbors = Map<string, Map<string, Direction | undefined>>;
export type GraphLayout = Exclude<PreservedGraphLayout, "dag">;

function getLayoutDirection(x: number, y: number): Direction | undefined {
  if (!x && !y) return;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? Direction.Right : Direction.Left;
  return y > 0 ? Direction.Down : Direction.Up;
}

function offsetOutside(value: number, min: number, max: number): number {
  return value - Math.max(min, Math.min(value, max));
}

@service("autoLayout")
export class AutoLayout {
  constructor(private readonly project: Project) {}

  /**
   * DAG布局算法输入数据结构
   */
  private getDAGLayoutInput(entities: ConnectableEntity[]): {
    nodes: Array<{ id: string; rectangle: Rectangle }>;
    edges: Array<{ from: string; to: string }>;
  } {
    // 构建节点映射，使用UUID作为唯一标识
    const nodeMap = new Map<string, ConnectableEntity>();
    const nodes = entities.map((entity) => {
      nodeMap.set(entity.uuid, entity);
      return {
        id: entity.uuid,
        rectangle: entity.collisionBox.getRectangle(),
      };
    });

    // 构建边关系
    const edges: Array<{ from: string; to: string }> = [];
    for (const entity of entities) {
      const children = this.project.graphMethods.nodeChildrenArray(entity);
      for (const child of children) {
        // 只包含选中实体之间的连接
        if (nodeMap.has(child.uuid)) {
          edges.push({
            from: entity.uuid,
            to: child.uuid,
          });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * DAG布局算法接口
   * @param input 包含节点和边的DAG结构
   * @returns 每个节点的新位置 { [nodeId: string]: Vector }
   */
  private computeDAGLayout(input: {
    nodes: Array<{ id: string; rectangle: Rectangle }>;
    edges: Array<{ from: string; to: string }>;
  }): { [nodeId: string]: Vector } {
    const { nodes, edges } = input;
    // 先对节点进行拓扑排序并计算层数
    const { order: topologicalOrder, levels } = this.topologicalSort(nodes, edges);

    // 根据层数对节点进行分组
    const nodesByLevel: Map<number, string[]> = new Map();
    levels.forEach((level, nodeId) => {
      if (!nodesByLevel.has(level)) {
        nodesByLevel.set(level, []);
      }
      nodesByLevel.get(level)?.push(nodeId);
    });

    // 创建节点ID到节点信息的映射
    const nodeMap: Map<string, { id: string; rectangle: Rectangle }> = new Map();
    nodes.forEach((node) => {
      nodeMap.set(node.id, node);
    });

    // 计算每个节点的新位置
    const newPositions: { [nodeId: string]: Vector } = {};

    // 定义层间距和节点间距
    const horizontalSpacing = 150; // 层与层之间的基本水平间距
    const verticalSpacing = 100; // 同一层节点之间的垂直间距

    // 处理第一个节点（拓扑序第一个）
    if (topologicalOrder.length > 0) {
      const firstNodeId = topologicalOrder[0];
      const firstNode = nodeMap.get(firstNodeId)!;
      // 第一个节点位置保持不变
      newPositions[firstNodeId] = firstNode.rectangle.location;

      // 获取第一个节点的初始位置，作为所有层第一个元素的水平参考点
      const firstNodePos = newPositions[firstNodeId];
      const baseY = firstNodePos.y;

      // 计算每层的最长矩形宽度
      const maxLevel = Math.max(...Array.from(levels.values()));
      const levelMaxWidths: Map<number, number> = new Map();

      for (let level = 0; level <= maxLevel; level++) {
        const nodesInLevel = nodesByLevel.get(level) || [];
        let maxWidth = 0;

        for (const nodeId of nodesInLevel) {
          const node = nodeMap.get(nodeId)!;
          const nodeWidth = node.rectangle.width;
          if (nodeWidth > maxWidth) {
            maxWidth = nodeWidth;
          }
        }

        levelMaxWidths.set(level, maxWidth);
      }

      // 计算每层的水平偏移，考虑前一层的最长矩形宽度
      const levelOffsets: Map<number, number> = new Map();
      levelOffsets.set(0, firstNodePos.x); // 第一层的偏移就是第一个节点的x坐标

      for (let level = 1; level <= maxLevel; level++) {
        // 前一层的偏移
        const prevOffset = levelOffsets.get(level - 1) || 0;
        // 前一层的最长矩形宽度
        const prevMaxWidth = levelMaxWidths.get(level - 1) || 0;
        // 当前层的偏移 = 前一层偏移 + 前一层最长宽度 + 水平间距
        const currentOffset = prevOffset + prevMaxWidth + horizontalSpacing;
        levelOffsets.set(level, currentOffset);
      }

      // 按层数处理所有节点
      for (let level = 0; level <= maxLevel; level++) {
        const nodesInLevel = nodesByLevel.get(level) || [];
        if (nodesInLevel.length === 0) continue;

        // 计算当前层的水平位置
        const levelX = levelOffsets.get(level) || 0;

        // 处理当前层的所有节点
        for (let i = 0; i < nodesInLevel.length; i++) {
          const currentNodeId = nodesInLevel[i];

          // 如果是第一层第一个节点，已经处理过，跳过
          if (level === 0 && i === 0) continue;

          // 计算垂直位置：基于第一层第一个节点的y坐标加上垂直间距
          // 同一层的节点在垂直方向上排列
          const newY = baseY + i * verticalSpacing;

          // 设置节点位置
          newPositions[currentNodeId] = new Vector(levelX, newY);
        }
      }
    }

    return newPositions;
  }

  /**
   * 使用Kahn算法对DAG进行拓扑排序，并计算节点层数
   * @param nodes 节点数组
   * @param edges 边数组
   * @returns 包含拓扑排序结果和节点层数映射的对象
   */
  private topologicalSort(
    nodes: Array<{ id: string; rectangle: Rectangle }>,
    edges: Array<{ from: string; to: string }>,
  ): { order: string[]; levels: Map<string, number> } {
    // 构建邻接表和入度映射
    const adjacencyList: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();
    // 用于存储每个节点的层数
    const levels: Map<string, number> = new Map();

    // 初始化邻接表、入度和层数
    nodes.forEach((node) => {
      adjacencyList.set(node.id, []);
      inDegree.set(node.id, 0);
      levels.set(node.id, 0); // 初始层数设为0
    });

    // 填充邻接表和计算入度
    edges.forEach((edge) => {
      const { from, to } = edge;
      // 添加边到邻接表
      adjacencyList.get(from)?.push(to);
      // 增加目标节点的入度
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    });

    // 初始化队列，加入所有入度为0的节点
    const queue: string[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
        levels.set(nodeId, 0); // 入度为0的节点层数为0
      }
    });

    const result: string[] = [];

    // 执行拓扑排序
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      // 获取当前节点的层数
      const currentLevel = levels.get(current)!;

      // 遍历当前节点的所有邻居
      const neighbors = adjacencyList.get(current) || [];
      neighbors.forEach((neighbor) => {
        // 减少邻居的入度
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);

        // 计算邻居节点的层数，取当前计算值与已有值的最大值
        const neighborLevel = Math.max(levels.get(neighbor) || 0, currentLevel + 1);
        levels.set(neighbor, neighborLevel);

        // 如果入度变为0，加入队列
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      });
    }

    // 检查是否存在环（如果结果长度不等于节点数，说明存在环）
    if (result.length !== nodes.length) {
      console.warn("DAG布局警告：图中存在环，拓扑排序结果可能不完整");
      // 可以选择返回部分结果或抛出错误，这里选择返回部分结果
    }

    return { order: result, levels };
  }

  /**
   * DAG布局主函数
   * @param entities 选中的实体列表
   */
  public autoLayoutDAG(entities: ConnectableEntity[]): DAGLayoutResult {
    const input = this.getDAGLayoutInput(entities);
    const newPositions = this.computeDAGLayout(input);
    const nodeMap = new Map<string, ConnectableEntity>();
    entities.forEach((entity) => nodeMap.set(entity.uuid, entity));
    const previousLayouts = new Map(
      this.project.stageManager
        .getEdges()
        .filter(
          (edge) => edge.source !== edge.target && newPositions[edge.source.uuid] && newPositions[edge.target.uuid],
        )
        .map((edge) => [edge, edge.graphLayout]),
    );
    const previousLocations = new Map(
      entities.map((entity) => [entity, entity.collisionBox.getRectangle().location.clone()]),
    );
    const previousSectionCollision = Settings.isEnableSectionCollision;
    Settings.isEnableSectionCollision = false;

    try {
      for (const [nodeId, position] of Object.entries(newPositions)) {
        const entity = nodeMap.get(nodeId);
        if (entity) {
          entity.moveTo(position);
        }
      }

      this.setGraphLayout(previousLayouts.keys(), "dag");
      this.project.historyManager.recordStep();
    } catch (error) {
      for (const [entity, location] of previousLocations) {
        entity.moveTo(location);
      }
      for (const [edge, layout] of previousLayouts) edge.graphLayout = layout;
      throw error;
    } finally {
      Settings.isEnableSectionCollision = previousSectionCollision;
    }

    toast.success("DAG布局已应用");
    return { movedCount: Object.keys(newPositions).length, internalEdgeCount: input.edges.length };
  }

  public autoLayoutMindMap(entities: ConnectableEntity[]): boolean {
    return this.autoLayoutGraph(entities, "mindMap");
  }

  public autoLayoutGraph(entities: ConnectableEntity[], layout: GraphLayout): boolean {
    const selectedRoot = layout === "mindMap" && entities.length === 1 ? entities[0] : undefined;
    const byId = new Map(entities.map((entity) => [entity.uuid, entity]));
    let edges: Edge[];
    if (selectedRoot) {
      const sections = new Set<ConnectableEntity>(this.project.stageManager.getSections());
      const movableNodes = new Map(
        this.project.stageManager
          .getConnectableEntity()
          .filter(
            (entity) =>
              !sections.has(entity) && !entity.nearestLockedAncestorSection && !entity.isHiddenBySectionCollapse,
          )
          .map((entity) => [entity.uuid, entity]),
      );
      edges = [];
      for (const edge of this.project.stageManager.getEdges()) {
        const { source, target } = edge;
        const neighborId =
          source.uuid === selectedRoot.uuid ? target.uuid : target.uuid === selectedRoot.uuid ? source.uuid : undefined;
        if (neighborId === undefined || neighborId === selectedRoot.uuid) continue;
        const neighbor = movableNodes.get(neighborId);
        if (!neighbor) continue;
        byId.set(neighborId, neighbor);
        edges.push(edge);
      }
      if (byId.size === 1) return true;
    } else {
      edges = this.project.stageManager
        .getEdges()
        .filter(({ source, target }) => byId.has(source.uuid) && byId.has(target.uuid));
      if (byId.size < 2) return false;
    }

    const nodes = Array.from(byId.values(), (entity) => ({
      id: entity.uuid,
      rectangle: entity.collisionBox.getRectangle(),
    }));
    const rectangles = new Map(nodes.map(({ id, rectangle }) => [id, rectangle]));

    const neighbors = new Map(nodes.map(({ id }) => [id, new Map<string, Direction | undefined>()]));
    const outgoing = new Map(nodes.map(({ id }) => [id, new Set<string>()]));
    const incoming = new Map(nodes.map(({ id }) => [id, new Set<string>()]));
    for (const edge of edges) {
      const from = edge.source.uuid;
      const to = edge.target.uuid;
      const fromNeighbors = neighbors.get(from)!;
      const toNeighbors = neighbors.get(to)!;
      if (from === to) continue;
      const sourceNormal = Edge.getNormalVectorByRate(edge.sourceRectangleRate);
      const targetNormal = Edge.getNormalVectorByRate(edge.targetRectangleRate);
      const fromDirection = sourceNormal ?? targetNormal?.multiply(-1);
      const toDirection = targetNormal ?? sourceNormal?.multiply(-1);
      fromNeighbors.set(
        to,
        fromNeighbors.get(to) ?? (fromDirection && getLayoutDirection(fromDirection.x, fromDirection.y)),
      );
      toNeighbors.set(from, toNeighbors.get(from) ?? (toDirection && getLayoutDirection(toDirection.x, toDirection.y)));
      outgoing.get(from)!.add(to);
      incoming.get(to)!.add(from);
    }
    const placements = this.layoutConnectedGroups(
      layout,
      neighbors,
      incoming,
      outgoing,
      rectangles,
      selectedRoot?.uuid,
    );
    const moved = [...placements].filter(([id, rect]) => !rect.location.equals(rectangles.get(id)!.location));

    const ancestors = new Set<Section>();
    this.project.sectionMoveDepth++;
    try {
      for (const [id, rectangle] of moved) {
        const entity = byId.get(id)!;
        for (let section = entity.parentSection; section; section = section.parentSection) ancestors.add(section);
        entity.moveTo(rectangle.location);
      }
    } finally {
      this.project.sectionMoveDepth--;
      for (const section of [...ancestors].sort((a, b) => b.sectionDepth - a.sectionDepth)) {
        section.adjustLocationAndSize();
      }
    }
    const portsChanged = layout === "fishbone" && this.alignFishbonePorts(edges, placements);
    const layoutChanged = this.setGraphLayout(edges, layout);
    if (moved.length || portsChanged || layoutChanged) this.project.historyManager.recordStep();
    return true;
  }

  private setGraphLayout(edges: Iterable<Edge>, layout?: PreservedGraphLayout): boolean {
    let changed = false;
    for (const edge of edges) {
      if (edge.source === edge.target || edge.graphLayout === layout) continue;
      edge.graphLayout = layout;
      changed = true;
    }
    return changed;
  }

  public getPreservedLayout(node: ConnectableEntity): PreservedGraphLayout | undefined {
    return this.project.stageManager
      .getEdges()
      .find((edge) => edge.graphLayout && (edge.source === node || edge.target === node))?.graphLayout;
  }

  public hasPreservedLayoutInTree(root: ConnectableEntity): boolean {
    const markedEdges = this.project.stageManager.getEdges().filter((edge) => edge.graphLayout);
    if (!markedEdges.length) return false;
    const nodes = new Set(this.project.graphMethods.getSuccessorSet(root, true, true));
    return markedEdges.some((edge) => nodes.has(edge.source) || nodes.has(edge.target));
  }

  public clearPreservedLayout(nodes: ConnectableEntity[]) {
    const byNode = new Set(nodes);
    const edges = this.project.stageManager
      .getEdges()
      .filter((edge) => byNode.has(edge.source) && byNode.has(edge.target));
    this.setGraphLayout(edges);
  }

  private alignFishbonePorts(edges: Edge[], placements: ReadonlyMap<string, Rectangle>): boolean {
    const automatic = Vector.same(0.5);
    let changed = false;
    for (const edge of edges) {
      if (!(edge instanceof LineEdge)) continue;
      const source = placements.get(edge.source.uuid)!;
      const target = placements.get(edge.target.uuid)!;
      if (source.right >= target.left) continue;

      // 自动端口贴到左右边的中点，让相邻分支从主轴同一点展开。
      if (edge.source.clipConnectionToBoundary && edge.sourceRectangleRate.equals(automatic)) {
        edge.sourceRectangleRate = new Vector(0.99, 0.5);
        changed = true;
      }
      if (edge.target.clipConnectionToBoundary && edge.targetRectangleRate.equals(automatic)) {
        edge.targetRectangleRate = new Vector(0.01, 0.5);
        changed = true;
      }
    }
    return changed;
  }

  private layoutConnectedGroups(
    layout: GraphLayout,
    neighbors: MindMapNeighbors,
    incoming: Map<string, Set<string>>,
    outgoing: Map<string, Set<string>>,
    rectangles: Map<string, Rectangle>,
    selectedRoot?: string,
  ): Map<string, Rectangle> {
    const unvisited = new Set(rectangles.keys());
    const components: { nodes: MindMapNode[]; degreeSum: number }[] = [];
    for (const id of unvisited) {
      unvisited.delete(id);
      let degreeSum = 0;
      const ids = [id];
      for (const current of ids) {
        const adjacent = neighbors.get(current)!;
        degreeSum += adjacent.size;
        for (const neighbor of adjacent.keys()) {
          if (unvisited.delete(neighbor)) ids.push(neighbor);
        }
      }
      components.push({ nodes: ids.map((id) => ({ id, rectangle: rectangles.get(id)! })), degreeSum });
    }
    components.sort((a, b) => b.degreeSum - a.degreeSum || b.nodes.length - a.nodes.length);

    const placements = new Map<string, Rectangle>();
    const occupied: Rectangle[] = [];
    for (const { nodes } of components) {
      let group: Map<string, Rectangle>;
      if (layout === "fishbone") {
        group = layoutFishbone(new Map(nodes.map(({ id, rectangle }) => [id, rectangle])), incoming, outgoing);
      } else {
        const root = selectedRoot ? nodes[0] : this.getMindMapRoot(nodes, neighbors, outgoing, incoming);
        group = this.layoutMindMapComponent(root, neighbors, outgoing, rectangles);
      }
      const bounds = Rectangle.getBoundingRectangle([...group.values()]);
      const main = occupied[0];
      const delta = main ? this.findMindMapGroupShift(bounds, main, occupied) : Vector.getZero();
      for (const [id, rectangle] of group) {
        placements.set(id, new Rectangle(rectangle.location.add(delta), rectangle.size));
      }
      occupied.push(new Rectangle(bounds.location.add(delta), bounds.size));
    }
    return placements;
  }

  private getMindMapRoot(
    nodes: MindMapNode[],
    neighbors: MindMapNeighbors,
    outgoing: Map<string, Set<string>>,
    incoming: Map<string, Set<string>>,
  ): MindMapNode {
    const hub = nodes.reduce((best, node) => {
      const degree = neighbors.get(node.id)!.size;
      const bestDegree = neighbors.get(best.id)!.size;
      return degree > bestDegree || (degree === bestDegree && outgoing.get(node.id)!.size > outgoing.get(best.id)!.size)
        ? node
        : best;
    });
    const roots = nodes.filter(({ id }) => incoming.get(id)!.size === 0);
    const directedLinkCount = nodes.reduce((count, { id }) => count + outgoing.get(id)!.size, 0);
    const treeRoot = directedLinkCount === nodes.length - 1 && roots.length === 1 ? roots[0] : undefined;
    // 有明确根节点的树延续原有布局，复杂图以联系最多的节点为中心。
    return treeRoot && (outgoing.get(treeRoot.id)!.size > 1 || neighbors.get(hub.id)!.size < 3) ? treeRoot : hub;
  }

  private findMindMapGroupShift(bounds: Rectangle, main: Rectangle, occupied: Rectangle[]): Vector {
    const gap = 64;
    const center = bounds.center.subtract(main.center);
    const direction = getLayoutDirection(center.x, center.y) ?? Direction.Right;
    const vertical = direction === Direction.Up || direction === Direction.Down;
    const sign = direction === Direction.Up || direction === Direction.Left ? -1 : 1;
    const shift = new Vector(0, 0);
    // 按远离主结构的方向移动，保留不重叠的部分原有位置。
    for (const obstacle of [...occupied].sort((a, b) => {
      const edgeA = vertical ? (sign > 0 ? a.top : a.bottom) : sign > 0 ? a.left : a.right;
      const edgeB = vertical ? (sign > 0 ? b.top : b.bottom) : sign > 0 ? b.left : b.right;
      return sign * (edgeA - edgeB);
    })) {
      const moved = new Rectangle(bounds.location.add(shift), bounds.size);
      if (!moved.expandFromCenter(gap).isCollideWith(obstacle)) continue;
      if (vertical) {
        shift.y = sign > 0 ? obstacle.bottom + gap - bounds.top : obstacle.top - gap - bounds.bottom;
      } else {
        shift.x = sign > 0 ? obstacle.right + gap - bounds.left : obstacle.left - gap - bounds.right;
      }
    }
    return shift;
  }

  private layoutMindMapComponent(
    root: MindMapNode,
    neighbors: MindMapNeighbors,
    outgoing: Map<string, Set<string>>,
    rectangles: Map<string, Rectangle>,
  ): Map<string, Rectangle> {
    const rootRect = root.rectangle;
    const directions = [Direction.Left, Direction.Right, Direction.Up, Direction.Down];
    const groups = new Map(directions.map((direction) => [direction, [] as string[]]));
    const visited = new Set([root.id]);
    for (const [child, portDirection] of neighbors.get(root.id)!) {
      const center = rectangles.get(child)!.center;
      const x = offsetOutside(center.x, rootRect.left, rootRect.right);
      const y = offsetOutside(center.y, rootRect.top, rootRect.bottom);
      // 固定端口决定曲线的出入方向，优先将分支排到端口所在侧。
      const direction =
        portDirection ??
        getLayoutDirection(x, y) ??
        (outgoing.get(root.id)!.has(child) ? Direction.Right : Direction.Left);
      groups.get(direction)!.push(child);
      visited.add(child);
    }
    const children = new Map<string, string[]>();
    // 先按距中心的层数确定父子关系，交叉连线保留在画布上。
    const pending = [...groups.values()].flat();
    for (const id of pending) {
      const branch = [...neighbors.get(id)!.keys()].filter((neighbor) => !visited.has(neighbor));
      children.set(id, branch);
      for (const child of branch) {
        visited.add(child);
        pending.push(child);
      }
    }
    const branchGap = 32;
    const depthGap = 120;
    const placements = new Map([[root.id, rootRect]]);
    const horizontalBounds: Rectangle[] = [];

    for (const [direction, group] of groups) {
      if (group.length === 0) continue;
      const vertical = direction === Direction.Up || direction === Direction.Down;
      const sign = direction === Direction.Left || direction === Direction.Up ? -1 : 1;
      const depthSize = (rect: Rectangle) => (vertical ? rect.height : rect.width);
      const crossSize = (rect: Rectangle) => (vertical ? rect.width : rect.height);
      const crossCenter = (rect: Rectangle) => (vertical ? rect.center.x : rect.center.y);
      const crossOrder = (a: string, b: string) => crossCenter(rectangles.get(a)!) - crossCenter(rectangles.get(b)!);
      group.sort(crossOrder);

      const ordered = group.map((id) => ({ id, depth: 0 }));
      const depthSizes: number[] = [];
      for (const { id, depth } of ordered) {
        depthSizes[depth] = Math.max(depthSizes[depth] ?? 0, depthSize(rectangles.get(id)!));
        const branch = children.get(id)!.sort(crossOrder);
        for (const child of branch) ordered.push({ id: child, depth: depth + 1 });
      }

      const rootEdge = vertical
        ? sign > 0
          ? rootRect.bottom
          : rootRect.top
        : sign > 0
          ? rootRect.right
          : rootRect.left;
      let edge = rootEdge;
      const levels = depthSizes.map((size) => {
        const nearEdge = edge + sign * depthGap;
        edge = nearEdge + sign * size;
        return nearEdge;
      });

      const spans = new Map<string, number>();
      const branchSpan = (branch: string[]) =>
        branch.reduce((span, child) => span + spans.get(child)!, 0) + Math.max(0, branch.length - 1) * branchGap;
      for (const { id } of [...ordered].reverse()) {
        spans.set(id, Math.max(crossSize(rectangles.get(id)!), branchSpan(children.get(id)!)));
      }

      const centers = new Map<string, number>();
      const placeSiblings = (siblings: string[], center: number) => {
        let position = center - branchSpan(siblings) / 2;
        for (const sibling of siblings) {
          const span = spans.get(sibling)!;
          centers.set(sibling, position + span / 2);
          position += span + branchGap;
        }
      };
      placeSiblings(group, crossCenter(rootRect));

      for (const { id, depth } of ordered) {
        const center = centers.get(id)!;
        placeSiblings(children.get(id)!, center);
        const rect = rectangles.get(id)!;
        const along = levels[depth] - (sign < 0 ? depthSize(rect) : 0);
        const across = center - crossSize(rect) / 2;
        placements.set(id, new Rectangle(vertical ? new Vector(across, along) : new Vector(along, across), rect.size));
      }

      let shift = 0;
      for (const id of group) {
        if (neighbors.get(root.id)!.get(id) !== undefined) continue;
        const center = placements.get(id)!.center;
        const across = vertical
          ? offsetOutside(center.x, rootRect.left, rootRect.right)
          : offsetOutside(center.y, rootRect.top, rootRect.bottom);
        const along = sign * ((vertical ? center.y : center.x) - rootEdge);
        // 留在自动识别的方向内，避免再次布局时边缘节点被分到相邻方向。
        shift = Math.max(shift, Math.abs(across) - along + 1);
      }

      const groupRectangles = ordered.map(({ id }) => placements.get(id)!);
      const bounds = Rectangle.getBoundingRectangle(groupRectangles);
      if (vertical) {
        shift = horizontalBounds.reduce((distance, horizontal) => {
          if (bounds.right + branchGap <= horizontal.left || bounds.left - branchGap >= horizontal.right)
            return distance;
          return Math.max(
            distance,
            sign > 0 ? horizontal.bottom + branchGap - bounds.top : bounds.bottom + branchGap - horizontal.top,
          );
        }, shift);
      }
      const delta = vertical ? new Vector(0, shift * sign) : new Vector(shift * sign, 0);
      for (const rectangle of groupRectangles) rectangle.location = rectangle.location.add(delta);
      if (!vertical) horizontalBounds.push(new Rectangle(bounds.location.add(delta), bounds.size));
    }
    return placements;
  }
}
