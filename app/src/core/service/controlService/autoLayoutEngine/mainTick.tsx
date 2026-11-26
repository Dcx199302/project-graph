import { Project, service } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { getLayoutItem, getLayoutScope } from "@/core/stage/stageManager/basicMethods/sectionLayout";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Edge, type PreservedGraphLayout } from "@/core/stage/stageObject/association/Edge";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Direction } from "@/types/directions";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { toast } from "sonner";
import {
  approachesMindMapLeafVertically,
  getMindMapSiblingRows,
  layoutFishbone,
  layoutVerticalMindMap,
  mindMapDepthScale,
  mindMapSpacing,
  packMindMapSiblingRows,
  type MindMapBranch,
} from "./directedLayouts";

export type DAGLayoutResult = {
  movedCount: number;
  internalEdgeCount: number;
};

type MindMapNode = { id: string; rectangle: Rectangle };
type MindMapNeighbors = Map<string, Map<string, Direction | undefined>>;
export type GraphLayout = Exclude<PreservedGraphLayout, "dag">;
export type MindMapGrowthNode = { text: string; parentIndex?: number };

const mindMapFontStep = 1;
const mindMapMaxFontReduction = 2;

export function mindMapChildFontLevel(parent: ConnectableEntity) {
  const level = parent instanceof TextNode ? parent.fontScaleLevel : 0;
  const minimum = -mindMapMaxFontReduction;
  return level <= minimum ? level : Math.max(minimum, level - mindMapFontStep);
}

function getMindMapTreeLinks(edges: readonly Edge[]) {
  const children = new Map<ConnectableEntity, Set<ConnectableEntity>>();
  const parents = new Map<ConnectableEntity, Set<ConnectableEntity>>();
  for (const edge of edges) {
    if (edge instanceof LineEdge && edge.lineType === "dashed") continue;
    const { source, target } = edge;
    if (!children.has(source)) children.set(source, new Set());
    if (!parents.has(target)) parents.set(target, new Set());
    children.get(source)!.add(target);
    parents.get(target)!.add(source);
  }
  return { children, parents };
}

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

  public growMindMap(root: ConnectableEntity, entries: readonly MindMapGrowthNode[], newRoot = false): TextNode[] {
    if (newRoot) this.fitMindMapItem(root);
    if (!entries.length) return [];
    const adjacent = this.project.stageManager
      .getEdges()
      .filter((edge) => edge.source === root || edge.target === root);
    const relation = adjacent.find((edge) => edge.graphLayout === "mindMap" && edge.target === root) ?? adjacent[0];
    const delta = relation?.target.collisionBox
      .getRectangle()
      .center.subtract(relation.source.collisionBox.getRectangle().center);
    const direction = (delta && getLayoutDirection(delta.x, delta.y)) ?? Direction.Right;
    const vertical = direction === Direction.Up || direction === Direction.Down;
    const sign = direction === Direction.Up || direction === Direction.Left ? -1 : 1;
    const section = root.parentSection;
    const created: TextNode[] = [];
    const edges: LineEdge[] = [];
    for (const { text, parentIndex } of entries) {
      const parent = parentIndex === undefined ? root : created[parentIndex];
      const node = new TextNode(this.project, {
        text,
        fontScaleLevel: mindMapChildFontLevel(parent),
        borderStyle: Settings.textNodeInitBorderStyle,
      });
      const bounds = parent.collisionBox.getRectangle();
      const rect = node.collisionBox.getRectangle();
      const axis = vertical ? "y" : "x";
      const across = vertical ? "x" : "y";
      const location = bounds.center.subtract(rect.size.divide(2));
      location[axis] += sign * ((bounds.size[axis] + rect.size[axis]) / 2 + 120);
      location[across] += created.length * 8;
      node.moveTo(location);
      created.push(node);
      edges.push(new LineEdge(this.project, { associationList: [parent, node] }));
    }
    for (const node of created) this.project.stageManager.add(node, true);
    for (const edge of edges) this.project.stageManager.add(edge, true);
    if (section) section.children.push(...created);
    this.project.stageManager.updateReferences();
    this.formatMindMap(created, root);
    return created;
  }

  public formatMindMap(entities: ConnectableEntity[], growthRoot?: ConnectableEntity, reflow = true): boolean {
    const edges = this.project.stageManager.getEdges();
    const links = getMindMapTreeLinks(edges);
    const focus = !growthRoot && entities.length === 1 && !(entities[0] instanceof Section) ? entities[0] : undefined;
    const focusedDepths = new Map<ConnectableEntity, number>();
    if (growthRoot) {
      // 扩展一个已有分支时，让同一棵树的其他分支按新尺寸重新排布。
      const ancestors = new Set([growthRoot]);
      let root = growthRoot;
      while (links.parents.get(root)?.size === 1) {
        const parent = links.parents.get(root)!.values().next().value!;
        if (
          ancestors.has(parent) ||
          parent.nearestLockedAncestorSection ||
          parent.isHiddenBySectionCollapse ||
          (parent instanceof Section && parent.locked)
        )
          break;
        ancestors.add(parent);
        root = parent;
      }
      const tree = new Set([root, growthRoot, ...entities]);
      for (const node of tree) {
        for (const child of links.children.get(node) ?? []) {
          if (
            links.parents.get(child)?.size === 1 &&
            !child.isHiddenBySectionCollapse &&
            !child.nearestLockedAncestorSection &&
            !(child instanceof Section && child.locked)
          )
            tree.add(child);
        }
      }
      entities = [...tree];
    } else if (focus) {
      if (focus.nearestLockedAncestorSection || focus.isHiddenBySectionCollapse) return false;
      focusedDepths.set(focus, 0);
      for (const [node, depth] of focusedDepths) {
        for (const neighbor of [...(links.children.get(node) ?? []), ...(links.parents.get(node) ?? [])]) {
          if (
            focusedDepths.has(neighbor) ||
            neighbor.isHiddenBySectionCollapse ||
            neighbor.nearestLockedAncestorSection ||
            (neighbor instanceof Section && neighbor.locked)
          )
            continue;
          focusedDepths.set(neighbor, depth + 1);
        }
      }
      if (focusedDepths.size < 2) return true;
      entities = [...focusedDepths.keys()];
    } else {
      const selected = new Set(entities);
      for (const node of selected) {
        if (
          !(node instanceof Section) ||
          !node.mindMapBranch ||
          node.locked ||
          node.isCollapsed ||
          node.nearestLockedAncestorSection ||
          node.isHiddenBySectionCollapse
        )
          continue;
        for (const child of node.children) {
          if (child instanceof ConnectableEntity) selected.add(child);
        }
      }
      entities = [...selected];
    }

    const { grouped, depths, resized } = this.prepareMindMapBranches(entities, links, reflow, focusedDepths);
    const scope = getLayoutScope(entities);
    if (
      !growthRoot &&
      !grouped &&
      !resized &&
      !entities.some((node) => node.parentSection && (node.parentSection !== scope || node.parentSection.mindMapBranch))
    ) {
      return this.applyGraphLayout(entities, "mindMap", edges, true, 0, focus);
    }
    if (growthRoot && !reflow && !grouped) {
      if (growthRoot.parentSection) this.fitMindMapItem(growthRoot.parentSection);
      return true;
    }

    const edgesByScope = new Map<Section | null, Edge[]>();
    for (const edge of edges) {
      const parent = getLayoutScope([edge.source, edge.target]);
      if (!edgesByScope.has(parent)) edgesByScope.set(parent, []);
      edgesByScope.get(parent)!.push(edge);
    }
    const selected = new Set(entities);
    const coveredGroups = new Map<Section, boolean>();
    const coversGroup = (group: Section): boolean => {
      const cached = coveredGroups.get(group);
      if (cached !== undefined) return cached;
      const covered = group.children.every((child) => {
        if (!(child instanceof ConnectableEntity) || selected.has(child)) return true;
        if (child instanceof Section) return child.isCollapsed || child.locked || coversGroup(child);
        return !links.children.has(child) && !links.parents.has(child);
      });
      coveredGroups.set(group, covered);
      return covered;
    };
    const passes = new Map<Section | null, Set<ConnectableEntity>>();
    for (const node of entities) {
      for (let item: ConnectableEntity = node; ; ) {
        const parent = item.parentSection ?? null;
        if (
          parent &&
          parent !== scope &&
          !growthRoot &&
          !focus &&
          !parent.mindMapBranch &&
          (!edgesByScope.get(parent)?.some((edge) => !(edge instanceof LineEdge) || edge.lineType !== "dashed") ||
            !coversGroup(parent))
        ) {
          break;
        }
        if (!passes.has(parent)) passes.set(parent, new Set());
        const pass = passes.get(parent)!;
        if (pass.has(item)) break;
        pass.add(item);
        if (!parent || parent === scope) break;
        item = parent;
      }
    }
    // 内部排版完成后，外层仍将每个分组作为一个整体移动。
    passes.set(scope, new Set(entities.map((node) => getLayoutItem(node, scope)!)));
    for (const [parent, items] of [...passes].sort(([a], [b]) => (b?.sectionDepth ?? -1) - (a?.sectionDepth ?? -1))) {
      const root = parent?.mindMapBranch ? parent.children[0] : undefined;
      const depth = root instanceof ConnectableEntity ? (focusedDepths.get(root) ?? depths.get(root)) : undefined;
      if (items.size > 1) {
        this.applyGraphLayout([...items], "mindMap", edgesByScope.get(parent) ?? [], false, depth, focus);
      } else {
        const item = items.values().next().value;
        if (item instanceof Section && passes.has(item)) this.avoidMindMapItemOverlap(item);
      }
      parent?.adjustLocationAndSize();
    }
    if (scope) this.fitMindMapItem(scope);
    if (!growthRoot) this.project.historyManager.recordStep();
    return true;
  }

  private prepareMindMapBranches(
    entities: ConnectableEntity[],
    { children, parents }: ReturnType<typeof getMindMapTreeLinks>,
    resizeFonts: boolean,
    focusedDepths: ReadonlyMap<ConnectableEntity, number>,
  ) {
    const selected = new Set(
      entities.filter(
        (node) => !(node instanceof Section) && !node.nearestLockedAncestorSection && !node.isHiddenBySectionCollapse,
      ),
    );
    const branches = new Map<ConnectableEntity, { size: number; entries: ConnectableEntity[]; complete: boolean }>();
    const groups: Section[] = [];
    const pendingChildCounts = new Map<Section, number>();
    const decorationCounts = new Map<Section, number>();
    const depths = new Map<ConnectableEntity, number>();
    const fontLevels = new Map<TextNode, number>();
    const setFontLevels = (
      nodes: Iterable<ConnectableEntity>,
      levels: ReadonlyMap<ConnectableEntity, number>,
      rootLevel: number,
    ) => {
      for (const node of nodes) {
        const depth = levels.get(node)!;
        if (node instanceof TextNode && depth > 0) {
          fontLevels.set(node, rootLevel - Math.min(mindMapMaxFontReduction, depth * mindMapFontStep));
        }
      }
    };
    if (resizeFonts && focusedDepths.size) {
      const root = focusedDepths.keys().next().value;
      setFontLevels(focusedDepths.keys(), focusedDepths, root instanceof TextNode ? root.fontScaleLevel : 0);
    }
    for (const root of selected) {
      if ([...(parents.get(root) ?? [])].some((parent) => selected.has(parent))) continue;
      const tree = new Set([root]);
      depths.set(root, 0);
      let valid = true;
      for (const node of tree) {
        for (const child of children.get(node) ?? []) {
          if (!selected.has(child)) continue;
          if (tree.has(child) || parents.get(child)!.size !== 1) valid = false;
          else depths.set(child, depths.get(node)! + 1);
          tree.add(child);
        }
      }
      if (!valid) continue;

      if (resizeFonts && !focusedDepths.size) {
        const rootLevel = root instanceof TextNode ? root.fontScaleLevel : 0;
        setFontLevels(tree, depths, rootLevel);
      }

      for (const node of [...tree].reverse()) {
        const descendants = [...(children.get(node) ?? [])];
        const childrenResults = descendants.map((child) => branches.get(child));
        const descendantCount = childrenResults.reduce((total, child) => total + (child?.size ?? 0), 0);
        const size = descendantCount + 1;
        if (!childrenResults.every((child) => child?.complete)) {
          branches.set(node, { size, complete: false, entries: [] });
          continue;
        }
        const entries = [node, ...childrenResults.flatMap((child) => child?.entries ?? [])];
        const parent = node.parentSection ?? null;
        if (!entries.every((entry) => (entry.parentSection ?? null) === parent)) {
          branches.set(node, { size, complete: false, entries: [] });
          continue;
        }
        const parentChildCount = parent ? (pendingChildCounts.get(parent) ?? parent.children.length) : 0;
        let decorationCount = 0;
        if (parent && !parent.mindMapBranch && descendantCount > 5 && parentChildCount > entries.length) {
          decorationCount =
            decorationCounts.get(parent) ??
            parent.children.filter(
              (child) =>
                !(child instanceof Section) &&
                (!(child instanceof ConnectableEntity) || (!children.has(child) && !parents.has(child))),
            ).length;
          decorationCounts.set(parent, decorationCount);
        }
        // 手动框里的独立注释或涂鸦不应导致同一分支重新建框。
        if (
          parent &&
          (parentChildCount - decorationCount === entries.length ||
            (parent.mindMapBranch && parent.children[0] === node))
        ) {
          branches.set(node, { size, complete: true, entries: [parent] });
          continue;
        }
        if (descendantCount <= 5) {
          branches.set(node, { size, complete: true, entries });
          continue;
        }

        const section = new Section(this.project, {
          text: node instanceof TextNode ? node.text.split("\n")[0] : "",
          children: entries,
          mindMapBranch: true,
          borderStyle: Settings.sectionInitBorderStyle,
        });
        this.project.stageManager.add(section, true);
        // 子分组先创建，父级成员数需要反映这次合并，实际列表稍后统一更新。
        if (parent) pendingChildCounts.set(parent, parentChildCount - entries.length + 1);
        section.parentSection = parent;
        for (const entry of entries) entry.parentSection = section;
        groups.push(section);
        branches.set(node, { size, complete: true, entries: [section] });
      }
    }
    const resizedSections = new Set<Section>();
    let resized = false;
    this.project.sectionMoveDepth++;
    try {
      for (const [node, level] of fontLevels) {
        if (Math.abs(node.fontScaleLevel - level) < 1e-9) continue;
        node.setFontScaleLevel(level);
        resized = true;
        for (let parent = node.parentSection; parent; parent = parent.parentSection) resizedSections.add(parent);
      }
    } finally {
      this.project.sectionMoveDepth--;
    }
    if (groups.length) {
      for (const parent of pendingChildCounts.keys()) {
        parent.children = parent.children.filter((child) => child.parentSection === parent);
      }
      for (const section of groups) {
        if (section.parentSection && !section.parentSection.children.includes(section)) {
          section.parentSection.children.push(section);
        }
      }
      this.project.stageManager.updateReferences();
    } else {
      for (const section of [...resizedSections].sort((a, b) => b.sectionDepth - a.sectionDepth)) {
        section.adjustLocationAndSize();
      }
    }
    return { grouped: groups.length > 0, depths, resized };
  }

  public autoLayoutGraph(entities: ConnectableEntity[], layout: GraphLayout): boolean {
    return this.applyGraphLayout(entities, layout, this.project.stageManager.getEdges(), true);
  }

  private applyGraphLayout(
    entities: ConnectableEntity[],
    layout: GraphLayout,
    allEdges: Edge[],
    recordHistory: boolean,
    depthOffset = 0,
    focus?: ConnectableEntity,
  ): boolean {
    const selectedRoot = layout === "mindMap" && entities.length === 1 ? entities[0] : undefined;
    const scope = layout === "mindMap" ? getLayoutScope(entities) : null;
    const representatives = new Map<ConnectableEntity, ConnectableEntity | undefined>();
    const getItem = (entity: ConnectableEntity) => {
      if (!representatives.has(entity)) {
        representatives.set(entity, layout === "mindMap" ? getLayoutItem(entity, scope) : entity);
      }
      return representatives.get(entity);
    };
    const byId = new Map<string, ConnectableEntity>();
    for (const entity of entities) {
      const item = getItem(entity);
      if (
        item &&
        !item.isHiddenBySectionCollapse &&
        !(item instanceof Section && item.locked) &&
        !item.nearestLockedAncestorSection
      ) {
        byId.set(item.uuid, item);
      }
    }
    const edges: Edge[] = [];
    if (selectedRoot) {
      if (!byId.size) return false;
      for (const edge of allEdges) {
        const source = getItem(edge.source);
        const target = getItem(edge.target);
        const neighbor: ConnectableEntity | undefined =
          source === selectedRoot ? target : target === selectedRoot ? source : undefined;
        if (
          !neighbor ||
          neighbor === selectedRoot ||
          neighbor.isHiddenBySectionCollapse ||
          neighbor.nearestLockedAncestorSection ||
          (neighbor instanceof Section && neighbor.locked)
        )
          continue;
        byId.set(neighbor.uuid, neighbor);
        edges.push(edge);
      }
      if (byId.size === 1) return true;
    } else {
      if (byId.size < 2) return false;
      for (const edge of allEdges) {
        const source = getItem(edge.source);
        const target = getItem(edge.target);
        if (source && target && source !== target && byId.has(source.uuid) && byId.has(target.uuid)) edges.push(edge);
      }
    }

    const nodes = Array.from(byId.values(), (entity) => ({
      id: entity.uuid,
      rectangle: entity.collisionBox.getRectangle(),
    }));
    const rectangles = new Map(nodes.map(({ id, rectangle }) => [id, rectangle]));

    const neighbors = new Map(nodes.map(({ id }) => [id, new Map<string, Direction | undefined>()]));
    const outgoing = new Map(nodes.map(({ id }) => [id, new Set<string>()]));
    const incoming = new Map(nodes.map(({ id }) => [id, new Set<string>()]));
    const directEdges: Edge[] = [];
    for (const edge of edges) {
      const source = getItem(edge.source)!;
      const target = getItem(edge.target)!;
      const from = source.uuid;
      const to = target.uuid;
      const fromNeighbors = neighbors.get(from)!;
      const toNeighbors = neighbors.get(to)!;
      if (from === to) continue;
      // 键盘生长和拖拽连线也会保存边缘端点，只有手动固定后才约束布局方向。
      const direct = source === edge.source && target === edge.target;
      if (direct) directEdges.push(edge);
      const hasFixedPorts = direct && (!(edge instanceof LineEdge) || edge.fixedEndpoints === true);
      const sourceNormal = hasFixedPorts ? Edge.getNormalVectorByRate(edge.sourceRectangleRate) : null;
      const targetNormal = hasFixedPorts ? Edge.getNormalVectorByRate(edge.targetRectangleRate) : null;
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
    const fanParents = new Map<string, MindMapBranch>();
    const placements = this.layoutConnectedGroups(
      layout,
      neighbors,
      incoming,
      outgoing,
      rectangles,
      fanParents,
      new Set([...byId].filter(([, entity]) => entity instanceof Section).map(([id]) => id)),
      (focus && getItem(focus))?.uuid ?? selectedRoot?.uuid,
      depthOffset,
    );
    if (layout === "mindMap") this.avoidMindMapObstacles(placements, byId, scope);
    const moved = [...placements].filter(([id, rect]) => !rect.location.equals(rectangles.get(id)!.location));

    const ancestors = new Set<Section>();
    this.project.sectionMoveDepth++;
    try {
      for (const [id, rectangle] of moved) {
        const entity = byId.get(id)!;
        if (recordHistory) {
          for (let section = entity.parentSection; section; section = section.parentSection) ancestors.add(section);
        }
        if (entity instanceof Section) entity.moveTo(rectangle.location, new Set());
        else entity.moveTo(rectangle.location);
      }
    } finally {
      this.project.sectionMoveDepth--;
      for (const section of [...ancestors].sort((a, b) => b.sectionDepth - a.sectionDepth)) {
        section.adjustLocationAndSize();
      }
    }
    const portsChanged =
      layout === "fishbone"
        ? this.alignFishbonePorts(directEdges, placements)
        : this.alignMindMapFanPorts(directEdges, placements, fanParents);
    const layoutChanged = this.setGraphLayout(edges, layout);
    if (recordHistory && (moved.length || portsChanged || layoutChanged)) {
      if (scope && moved.length) this.fitMindMapItem(scope);
      this.project.historyManager.recordStep();
    }
    return true;
  }

  private avoidMindMapObstacles(
    placements: Map<string, Rectangle>,
    nodes: ReadonlyMap<string, ConnectableEntity>,
    scope: Section | null,
  ) {
    const siblings = scope?.children ?? this.project.stageManager.getTopLevelEntities();
    const obstacles = siblings
      .filter(
        (entity) =>
          !nodes.has(entity.uuid) &&
          !entity.isHiddenBySectionCollapse &&
          !("isBackground" in entity && entity.isBackground),
      )
      .map((entity) => entity.collisionBox.getRectangle());
    if (!obstacles.length) return;

    const [anchorId, anchor] = placements.entries().next().value!;
    const blocking =
      nodes.get(anchorId) instanceof Section
        ? obstacles.find((obstacle) => anchor.expandFromCenter(Section.outerMargin).isCollideWith(obstacle))
        : undefined;
    const offset = blocking ? this.findMindMapGroupShift(anchor, blocking, obstacles, 20) : Vector.getZero();
    const shiftedAnchor = new Rectangle(anchor.location.add(offset), anchor.size);
    for (const [id, bounds] of placements) {
      const placed = new Rectangle(bounds.location.add(offset), bounds.size);
      if (id !== anchorId) {
        placed.location = placed.location.add(this.findMindMapGroupShift(placed, shiftedAnchor, obstacles, 20));
      }
      placements.set(id, placed);
      obstacles.push(placed);
    }
  }

  private fitMindMapItem(item: ConnectableEntity) {
    for (let current: ConnectableEntity | null = item; current; current = current.parentSection) {
      if (current.nearestLockedAncestorSection || (current instanceof Section && current.locked)) return;
      if (current instanceof Section) current.adjustLocationAndSize();
      this.avoidMindMapItemOverlap(current);
    }
  }

  private avoidMindMapItemOverlap(item: ConnectableEntity) {
    if (item.nearestLockedAncestorSection || (item instanceof Section && item.locked)) return;
    const siblings = item.parentSection?.children ?? this.project.stageManager.getTopLevelEntities();
    const bounds = item.collisionBox.getRectangle();
    const obstacles = siblings
      .filter(
        (entity) =>
          entity !== item && !entity.isHiddenBySectionCollapse && !("isBackground" in entity && entity.isBackground),
      )
      .map((entity) => entity.collisionBox.getRectangle());
    const clearance = item instanceof Section ? bounds.expandFromCenter(Section.outerMargin) : bounds;
    const blocking = obstacles.find((obstacle) => clearance.isCollideWith(obstacle));
    if (!blocking) return;
    const delta = this.findMindMapGroupShift(bounds, blocking, obstacles, 20);
    this.project.sectionMoveDepth++;
    try {
      const location = bounds.location.add(delta);
      if (item instanceof Section) item.moveTo(location, new Set());
      else item.moveTo(location);
    } finally {
      this.project.sectionMoveDepth--;
    }
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

  private alignMindMapFanPorts(
    edges: Edge[],
    placements: ReadonlyMap<string, Rectangle>,
    fanParents: ReadonlyMap<string, MindMapBranch>,
  ) {
    if (fanParents.size === 0) return false;
    let changed = false;
    const canAdjust = (rate: Vector) =>
      rate.equals(Vector.same(0.5)) ||
      ((rate.x === 0.5 || rate.y === 0.5) && Edge.getNormalVectorByRate(rate) !== null);
    for (const edge of edges) {
      if (!(edge instanceof LineEdge) || edge.fixedEndpoints) continue;
      const from = edge.source.uuid;
      const to = edge.target.uuid;
      const forward = fanParents.get(to)?.parentId === from;
      const branch = fanParents.get(forward ? to : from);
      if (branch?.parentId !== (forward ? from : to)) continue;
      const parent = placements.get(branch.parentId)!;
      const child = placements.get(forward ? to : from)!;
      const down = parent.center.y < child.center.y;
      const parentRate = new Vector(0.5, down ? 0.99 : 0.01);
      const childRate =
        branch.side === 0 ? new Vector(0.5, down ? 0.01 : 0.99) : new Vector(branch.side < 0 ? 0.99 : 0.01, 0.5);
      const sourceRate = forward ? parentRate : childRate;
      const targetRate = forward ? childRate : parentRate;
      if (
        edge.source.clipConnectionToBoundary &&
        canAdjust(edge.sourceRectangleRate) &&
        !edge.sourceRectangleRate.equals(sourceRate)
      ) {
        edge.sourceRectangleRate = sourceRate;
        changed = true;
      }
      if (
        edge.target.clipConnectionToBoundary &&
        canAdjust(edge.targetRectangleRate) &&
        !edge.targetRectangleRate.equals(targetRate)
      ) {
        edge.targetRectangleRate = targetRate;
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
    fanParents: Map<string, MindMapBranch>,
    sections: ReadonlySet<string>,
    selectedRoot?: string,
    depthOffset = 0,
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
        const focus = nodes.find(({ id }) => id === selectedRoot);
        const { root, growthDirection } = focus
          ? { root: focus }
          : this.getMindMapRootAndDirection(nodes, neighbors, outgoing, incoming);
        group = this.layoutMindMapComponent(
          root,
          neighbors,
          outgoing,
          rectangles,
          fanParents,
          sections,
          depthOffset,
          growthDirection,
        );
      }
      const bounds = Rectangle.getBoundingRectangle([...group.values()]);
      const main = occupied[0];
      const gap = layout === "mindMap" ? mindMapSpacing.groups : 64;
      const delta = main ? this.findMindMapGroupShift(bounds, main, occupied, gap) : Vector.getZero();
      for (const [id, rectangle] of group) {
        placements.set(id, new Rectangle(rectangle.location.add(delta), rectangle.size));
      }
      occupied.push(new Rectangle(bounds.location.add(delta), bounds.size));
    }
    return placements;
  }

  private getMindMapRootAndDirection(
    nodes: MindMapNode[],
    neighbors: MindMapNeighbors,
    outgoing: Map<string, Set<string>>,
    incoming: Map<string, Set<string>>,
  ): { root: MindMapNode; growthDirection?: Direction } {
    const roots = nodes.filter(({ id }) => incoming.get(id)!.size === 0);
    const directedLinkCount = nodes.reduce((count, { id }) => count + outgoing.get(id)!.size, 0);
    const treeRoot = roots.length === 1 && directedLinkCount === nodes.length - 1 ? roots[0] : undefined;
    if (treeRoot && nodes.length > 1) {
      const rootRect = treeRoot.rectangle;
      const rootCenter = rootRect.center;
      const bounds = Rectangle.getBoundingRectangle(
        nodes.filter((node) => node !== treeRoot).map(({ rectangle }) => rectangle),
      );
      const center = bounds.center;
      // 优先判断根节点在哪一侧，以免已有树的横向或纵向跨度掩盖拖动方向。
      const growthDirection =
        getLayoutDirection(
          -offsetOutside(rootCenter.x, bounds.left, bounds.right),
          -offsetOutside(rootCenter.y, bounds.top, bounds.bottom),
        ) ??
        getLayoutDirection(
          offsetOutside(center.x, rootRect.left, rootRect.right),
          offsetOutside(center.y, rootRect.top, rootRect.bottom),
        );
      if (growthDirection !== undefined || outgoing.get(treeRoot.id)!.size > 1) {
        return { root: treeRoot, growthDirection };
      }
    }

    const hub = nodes.reduce((best, node) => {
      const degree = neighbors.get(node.id)!.size;
      const bestDegree = neighbors.get(best.id)!.size;
      return degree > bestDegree || (degree === bestDegree && outgoing.get(node.id)!.size > outgoing.get(best.id)!.size)
        ? node
        : best;
    });
    return { root: treeRoot && neighbors.get(hub.id)!.size < 3 ? treeRoot : hub };
  }

  private findMindMapGroupShift(bounds: Rectangle, main: Rectangle, occupied: Rectangle[], gap: number): Vector {
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
    fanParents: Map<string, MindMapBranch>,
    sections: ReadonlySet<string>,
    depthOffset: number,
    growthDirection?: Direction,
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
        growthDirection ??
        getLayoutDirection(x, y) ??
        (outgoing.get(root.id)!.has(child) ? Direction.Right : Direction.Left);
      groups.get(direction)!.push(child);
      visited.add(child);
    }
    const children = new Map<string, string[]>();
    const parents = new Map([...groups.values()].flat().map((child) => [child, root.id]));
    // 先按距中心的层数确定父子关系，交叉连线保留在画布上。
    const pending = [...groups.values()].flat();
    for (const id of pending) {
      const branch = [...neighbors.get(id)!.keys()].filter((neighbor) => !visited.has(neighbor));
      children.set(id, branch);
      for (const child of branch) {
        visited.add(child);
        parents.set(child, id);
        pending.push(child);
      }
    }
    const branchGap = mindMapSpacing.branches;
    const placements = new Map([[root.id, rootRect]]);
    const horizontalBounds: Rectangle[] = [];

    for (const [direction, group] of groups) {
      if (group.length === 0) continue;
      const vertical = direction === Direction.Up || direction === Direction.Down;
      const depthGap = vertical ? mindMapSpacing.verticalLevels : mindMapSpacing.horizontalLevels;
      const isVerticalTree = vertical && direction === growthDirection;
      const sign = direction === Direction.Left || direction === Direction.Up ? -1 : 1;
      const depthSize = (rect: Rectangle) => (vertical ? rect.height : rect.width);
      const crossSize = (rect: Rectangle) => (vertical ? rect.width : rect.height);
      const crossCenter = (rect: Rectangle) => (vertical ? rect.center.x : rect.center.y);
      const crossOrder = (a: string, b: string) => crossCenter(rectangles.get(a)!) - crossCenter(rectangles.get(b)!);
      group.sort(crossOrder);

      const ordered = group.map((id) => ({ id, depth: 0 }));
      for (const { id, depth } of ordered) {
        const branch = children.get(id)!.sort(crossOrder);
        for (const child of branch) ordered.push({ id: child, depth: depth + 1 });
      }

      const farEdge = (rect: Rectangle) =>
        vertical ? (sign > 0 ? rect.bottom : rect.top) : sign > 0 ? rect.right : rect.left;
      const rootEdge = farEdge(rootRect);
      if (isVerticalTree && (group.length >= 5 || ordered.some(({ id }) => children.get(id)!.length >= 5))) {
        layoutVerticalMindMap(
          root.id,
          group,
          ordered.map(({ id }) => id),
          children,
          rectangles,
          sections,
          sign,
          placements,
          fanParents,
          depthOffset,
        );
      } else {
        const layouts = new Map<string, ReturnType<typeof packMindMapSiblingRows>>();
        const nodes = [{ id: root.id, depth: -1 }, ...ordered];
        for (const { id, depth } of [...nodes].reverse()) {
          const siblings = id === root.id ? group : children.get(id)!;
          const gap = branchGap * mindMapDepthScale(depthOffset + depth + 1);
          const rows = getMindMapSiblingRows(siblings, rectangles, sections);
          const packed = packMindMapSiblingRows(rows, layouts, gap);
          const rect = rectangles.get(id)!;
          packed.width = Math.max(crossSize(rect), packed.width);
          packed.height += depthSize(rect) + (siblings.length ? depthGap : 0);
          layouts.set(id, packed);
        }
        for (const { id } of nodes) {
          const parent = placements.get(id)!;
          for (const [child, offset] of layouts.get(id)!.offsets) {
            const rect = rectangles.get(child)!;
            const along = farEdge(parent) + sign * (depthGap + offset.y) - (sign < 0 ? depthSize(rect) : 0);
            const across = crossCenter(parent) + offset.x - crossSize(rect) / 2;
            placements.set(
              child,
              new Rectangle(vertical ? new Vector(across, along) : new Vector(along, across), rect.size),
            );
          }
        }
      }

      let shift = 0;
      if (!isVerticalTree) {
        for (const id of group) {
          if (neighbors.get(root.id)!.get(id) !== undefined) continue;
          const center = placements.get(id)!.center;
          const across = vertical
            ? offsetOutside(center.x, rootRect.left, rootRect.right)
            : offsetOutside(center.y, rootRect.top, rootRect.bottom);
          const along = sign * ((vertical ? center.y : center.x) - rootEdge);
          // 按节点位置分组时，避免再次布局把边缘节点分到相邻方向。
          shift = Math.max(shift, Math.abs(across) - along + 1);
        }
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
      if (vertical) {
        for (const { id } of ordered) {
          if (children.get(id)!.length || fanParents.has(id)) continue;
          const parentId = parents.get(id)!;
          const parent = placements.get(parentId)!;
          const child = placements.get(id)!;
          const gap = sign > 0 ? child.top - parent.bottom : parent.top - child.bottom;
          if (approachesMindMapLeafVertically(child.center.x - parent.center.x, gap)) {
            fanParents.set(id, { parentId, side: 0 });
          }
        }
      }
      if (!vertical) horizontalBounds.push(new Rectangle(bounds.location.add(delta), bounds.size));
    }
    return placements;
  }
}
