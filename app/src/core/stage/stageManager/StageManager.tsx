import { Project, service } from "@/core/Project";
import { EntityShrinkEffect } from "@/core/service/feedbackService/effectEngine/concrete/EntityShrinkEffect";
import { PenStrokeDeletedEffect } from "@/core/service/feedbackService/effectEngine/concrete/PenStrokeDeletedEffect";
import { SoundService } from "@/core/service/feedbackService/SoundService";
import { Settings } from "@/core/service/Settings";
import { Association, ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageObject } from "@/core/stage/stageObject/abstract/StageObject";
import { ArcEdge } from "@/core/stage/stageObject/association/ArcEdge";
import { CubicCatmullRomSplineEdge } from "@/core/stage/stageObject/association/CubicCatmullRomSplineEdge";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { ConnectPoint } from "@/core/stage/stageObject/entity/ConnectPoint";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { LatexNode } from "@/core/stage/stageObject/entity/LatexNode";
import { PenStroke } from "@/core/stage/stageObject/entity/PenStroke";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { SvgNode } from "@/core/stage/stageObject/entity/SvgNode";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { UrlNode } from "@/core/stage/stageObject/entity/UrlNode";
import { Direction } from "@/types/directions";
// import { Serialized } from "@/types/node";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { toast } from "sonner";

// littlefean:应该改成类，实例化的对象绑定到舞台上。这成单例模式了
// 开发过程中会造成多开
// zty012:这个是存储数据的，和舞台无关，应该单独抽离出来
// 并且会在舞台之外的地方操作，所以应该是namespace单例

/**
 * 子场景的相机数据
 */
export type ChildCameraData = {
  /**
   * 传送门的左上角位置
   */
  location: Vector;
  zoom: number;
  /**
   * 传送门大小
   */
  size: Vector;
  /**
   * 相机的目标位置
   */
  targetLocation: Vector;
};

/**
 * 舞台管理器，也可以看成包含了很多操作方法的《舞台实体容器》
 * 管理节点、边的关系等，内部包含了舞台上的所有实体
 */
@service("stageManager")
export class StageManager {
  private selectAllScope: { objects: Set<StageObject>; kind: "downstream" | "connected" | "section" } | null = null;

  /**
   * 运行时缓存的根 Section 列表。
   * 它们没有直接父级 Section，会在 `updateReferences()` 中重建。
   */
  public rootSections: Section[] = [];

  /**
   * 运行时缓存的顶层实体列表。
   * 不在任何 Section 内的实体会出现在这里，会在 `updateReferences()` 中重建。
   */
  public topLevelEntities: Entity[] = [];

  /**
   * 最近一次运行时 Section 树重建时，被归一化丢弃的交叉父关系数量。
   * 该值不参与序列化，用于提示旧数据中曾存在多父嵌套。
   */
  public normalizedCrossParentRelationCount: number = 0;

  constructor(private readonly project: Project) {}

  public getRootSections(): Section[] {
    return [...this.rootSections];
  }

  public getTopLevelEntities(): Entity[] {
    return [...this.topLevelEntities];
  }

  public getNormalizedCrossParentRelationCount(): number {
    return this.normalizedCrossParentRelationCount;
  }

  /**
   * TODO: 这个get方法在2.0从O(1)变成O(N)了，可能是引起卡顿的原因，后面待排查
   * @param uuid
   * @returns
   */
  get(uuid: string) {
    return this.project.stage.find((node) => node.uuid === uuid);
  }

  isEmpty(): boolean {
    return this.project.stage.length === 0;
  }
  getTextNodes(): TextNode[] {
    return this.project.stage.filter((node) => node instanceof TextNode);
  }
  getConnectableEntity(): ConnectableEntity[] {
    return this.project.stage.filter((node) => {
      if (node instanceof ConnectableEntity) {
        // 排除背景图片
        if (node instanceof ImageNode && (node as ImageNode).isBackground) {
          return false;
        }
        return true;
      }
      return false;
    }) as ConnectableEntity[];
  }
  isEntityExists(uuid: string): boolean {
    return this.project.stage.filter((node) => node.uuid === uuid).length > 0;
  }
  getSections(): Section[] {
    return this.project.stage.filter((node) => node instanceof Section);
  }
  getImageNodes(): ImageNode[] {
    return this.project.stage.filter((node) => node instanceof ImageNode);
  }
  getConnectPoints(): ConnectPoint[] {
    return this.project.stage.filter((node) => node instanceof ConnectPoint);
  }
  getUrlNodes(): UrlNode[] {
    return this.project.stage.filter((node) => node instanceof UrlNode);
  }
  // getPortalNodes(): PortalNode[] {
  //   return this.project.stage.filter((node) => node instanceof PortalNode);
  // }
  getPenStrokes(): PenStroke[] {
    return this.project.stage.filter((node) => node instanceof PenStroke);
  }
  getSvgNodes(): SvgNode[] {
    return this.project.stage.filter((node) => node instanceof SvgNode);
  }
  getLatexNodes(): LatexNode[] {
    return this.project.stage.filter((node) => node instanceof LatexNode) as LatexNode[];
  }

  getStageObjects(): StageObject[] {
    return this.project.stage;
  }

  /**
   * 获取场上所有的实体
   * @returns
   */
  getEntities(): Entity[] {
    return this.project.stage.filter((node) => node instanceof Entity);
  }
  getEntitiesByUUIDs(uuids: string[]): Entity[] {
    return this.project.stage.filter((node) => uuids.includes(node.uuid) && node instanceof Entity) as Entity[];
  }
  isNoEntity(): boolean {
    return this.project.stage.filter((node) => node instanceof Entity).length === 0;
  }
  delete(stageObject: StageObject) {
    this.project.stage.splice(this.project.stage.indexOf(stageObject), 1);
  }

  getAssociations(): Association[] {
    return this.project.stage.filter((node) => node instanceof Association);
  }
  getEdges(): Edge[] {
    return this.project.stage.filter((node) => node instanceof Edge);
  }
  getLineEdges(): LineEdge[] {
    return this.project.stage.filter((node) => node instanceof LineEdge);
  }
  getCrEdges(): CubicCatmullRomSplineEdge[] {
    return this.project.stage.filter((node) => node instanceof CubicCatmullRomSplineEdge);
  }
  getArcEdges(): ArcEdge[] {
    return this.project.stage.filter((node) => node instanceof ArcEdge);
  }

  add(stageObject: StageObject, skipUpdateReferences = false) {
    this.project.stage.push(stageObject);
    if (!skipUpdateReferences) {
      this.updateReferences();
    }
  }

  /**
   * 更新节点的引用，将unknown的节点替换为真实的节点，保证对象在内存中的唯一性
   * 节点什么情况下会是unknown的？
   *
   * 包含了对分组框的更新
   * 包含了对Edge几何组偏移索引的更新（多重边/双向边自动散开）
   */
  updateReferences() {
    this.selectAllScope = null;
    // 一次性建立 uuid -> ConnectableEntity 索引。
    // 原实现是「实体 × 关系」双层全量遍历：每个实体都重新扫描一次关系列表，
    // 数千节点/边的工程下单次调用即 O(N*E)，连接、删除等高频路径会卡顿。
    const connectableEntities = new Map<string, ConnectableEntity>();
    for (const entity of this.getEntities()) {
      // 实体是可连接类型
      if (entity instanceof ConnectableEntity) {
        connectableEntities.set(entity.uuid, entity);
      }
    }
    for (const edge of this.getAssociations()) {
      if (!(edge instanceof Edge)) {
        continue;
      }
      if (edge.source.unknown) {
        const entity = connectableEntities.get(edge.source.uuid);
        if (entity) {
          edge.source = entity;
        }
      }
      if (edge.target.unknown) {
        const entity = connectableEntities.get(edge.target.uuid);
        if (entity) {
          edge.target = entity;
        }
      }
    }
    this.rebuildSectionRuntimeTree();

    // 以下是LineEdge几何组偏移索引的更新
    // 几何组 key：无向，(minNodeId, maxNodeId, epAtMin, epAtMax)
    // A→B 和 B→A 端点位置相同时归入同一几何组，统一分配 shiftingIndex
    const rateKey = (v: Vector): string => `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
    const geoGroups = new Map<string, LineEdge[]>();
    const firstEdgeByPair = new Map<string, LineEdge>();

    for (const edge of this.getLineEdges()) {
      edge.hasParallelLineEdge = false;
      if (edge.source.uuid === edge.target.uuid) {
        // 自环跳过，不参与几何组，shiftingIndex 保持 0
        edge.shiftingIndex = 0;
        continue;
      }
      const idA = edge.source.uuid;
      const idB = edge.target.uuid;
      const pair = idA <= idB ? `${idA}|${idB}` : `${idB}|${idA}`;
      const firstEdge = firstEdgeByPair.get(pair);
      if (firstEdge) {
        firstEdge.hasParallelLineEdge = true;
        edge.hasParallelLineEdge = true;
      } else {
        firstEdgeByPair.set(pair, edge);
      }
      let key: string;
      if (idA <= idB) {
        key = `${pair}|${rateKey(edge.sourceRectangleRate)}|${rateKey(edge.targetRectangleRate)}`;
      } else {
        // B→A 方向：交换端点对应关系，使 A→B 与 B→A 落入同一几何组
        key = `${pair}|${rateKey(edge.targetRectangleRate)}|${rateKey(edge.sourceRectangleRate)}`;
      }
      if (!geoGroups.has(key)) geoGroups.set(key, []);
      geoGroups.get(key)!.push(edge);
    }

    for (const [, edges] of geoGroups) {
      // 按 uuid 字典序稳定排序，避免重渲染时 index 跳变
      edges.sort((a, b) => a.uuid.localeCompare(b.uuid));
      const count = edges.length;
      // 对称分配 shiftingIndex：
      // count=1 → [0]
      // count=2 → [-1, 1]（跳过0，两条都弯，视觉对称）
      // count=3 → [-1, 0, 1]
      // count=4 → [-2, -1, 1, 2]
      // count=5 → [-2, -1, 0, 1, 2]
      for (let i = 0; i < count; i++) {
        let idx: number;
        if (count === 1) {
          idx = 0;
        } else if (count % 2 === 0) {
          const half = count / 2;
          idx = i < half ? i - half : i - half + 1;
        } else {
          idx = i - Math.floor(count / 2);
        }
        edges[i].shiftingIndex = idx;
      }
    }
  }

  private rebuildSectionRuntimeTree() {
    const entities = this.getEntities();
    const sections = this.getSections();
    const entityMap = new Map<string, Entity>();
    const originalChildrenMap = new Map<string, Entity[]>();
    const parentCandidates = new Map<string, Section[]>();

    this.rootSections = [];
    this.topLevelEntities = [];
    this.normalizedCrossParentRelationCount = 0;

    for (const entity of entities) {
      entityMap.set(entity.uuid, entity);
      entity.parentSection = null;
      entity.sectionDepth = 0;
      if (entity instanceof Section) {
        originalChildrenMap.set(entity.uuid, [...entity.children]);
      }
    }

    for (const section of sections) {
      const uniqueChildren: Entity[] = [];
      const seenChildUUIDs = new Set<string>();
      const rawChildren = originalChildrenMap.get(section.uuid) ?? [];
      for (const child of rawChildren) {
        const childObject = entityMap.get(child.uuid);
        if (!childObject || childObject === section || seenChildUUIDs.has(childObject.uuid)) {
          continue;
        }
        seenChildUUIDs.add(childObject.uuid);
        uniqueChildren.push(childObject);
        if (!parentCandidates.has(childObject.uuid)) {
          parentCandidates.set(childObject.uuid, []);
        }
        parentCandidates.get(childObject.uuid)!.push(section);
      }
      section.children = uniqueChildren;
    }

    for (const entity of entities) {
      const candidates = parentCandidates.get(entity.uuid) ?? [];
      const directParent = this.pickDirectParentSection(entity, candidates);
      entity.parentSection = directParent;
      this.normalizedCrossParentRelationCount += candidates.filter((section) => section !== directParent).length;
    }

    for (const section of sections) {
      section.children = section.children.filter((child) => child.parentSection === section);
    }

    for (const entity of entities) {
      if (entity.parentSection === null) {
        this.topLevelEntities.push(entity);
        if (entity instanceof Section) {
          this.rootSections.push(entity);
        }
      }
    }

    for (const entity of this.topLevelEntities) {
      this.assignSectionRuntimeInfo(entity, 0);
    }

    for (const entity of entities) {
      entity.isHiddenBySectionCollapse = false;
    }

    for (const section of sections.sort((a, b) => b.sectionDepth - a.sectionDepth)) {
      section.adjustLocationAndSize();
    }

    for (const rootSection of this.rootSections) {
      rootSection.adjustChildrenStateByCollapse(false);
    }
  }

  private pickDirectParentSection(entity: Entity, candidates: Section[]): Section | null {
    if (candidates.length === 0) {
      return null;
    }
    const validCandidates = candidates.filter((section) => {
      if (section === entity) {
        return false;
      }
      return true;
    });
    if (validCandidates.length === 0) {
      return null;
    }
    validCandidates.sort((a, b) => {
      const areaDiff = this.getEntityArea(a) - this.getEntityArea(b);
      if (areaDiff !== 0) {
        return areaDiff;
      }
      const rectA = a.collisionBox.getRectangle();
      const rectB = b.collisionBox.getRectangle();
      if (rectA.top !== rectB.top) {
        return rectA.top - rectB.top;
      }
      if (rectA.left !== rectB.left) {
        return rectA.left - rectB.left;
      }
      return a.uuid.localeCompare(b.uuid);
    });
    return validCandidates[0];
  }

  private assignSectionRuntimeInfo(entity: Entity, depth: number) {
    entity.sectionDepth = depth;
    if (!(entity instanceof Section)) {
      return;
    }
    for (const child of entity.children) {
      this.assignSectionRuntimeInfo(child, depth + 1);
    }
  }

  private getEntityArea(entity: Entity): number {
    const rect = entity.collisionBox.getRectangle();
    return rect.size.x * rect.size.y;
  }

  getTextNodeByUUID(uuid: string): TextNode | null {
    for (const node of this.getTextNodes()) {
      if (node.uuid === uuid) {
        return node;
      }
    }
    return null;
  }
  getConnectableEntityByUUID(uuid: string): ConnectableEntity | null {
    for (const node of this.getConnectableEntity()) {
      if (node.uuid === uuid) {
        return node;
      }
    }
    return null;
  }
  isSectionByUUID(uuid: string): boolean {
    return this.project.stage.find((node) => node.uuid === uuid) instanceof Section;
  }
  getSectionByUUID(uuid: string): Section | null {
    const entity = this.get(uuid);
    if (entity instanceof Section) {
      return entity;
    }
    return null;
  }

  /**
   * 计算所有节点的中心点
   */
  getCenter(): Vector {
    if (this.project.stage.length === 0) {
      return Vector.getZero();
    }
    const physicalObjects = this.project.stage.filter((node) => node.isPhysical);
    if (physicalObjects.length === 0) {
      return Vector.getZero();
    }
    const allNodesRectangle = Rectangle.getBoundingRectangle(
      physicalObjects.map((node) => node.collisionBox.getRectangle()),
    );
    return allNodesRectangle.center;
  }

  /**
   * 计算所有节点的大小
   */
  getSize(): Vector {
    if (this.project.stage.length === 0) {
      return new Vector(this.project.renderer.w, this.project.renderer.h);
    }
    const size = this.getBoundingRectangle().size;

    return size;
  }

  /**
   * 获取舞台的矩形对象
   */
  getBoundingRectangle(): Rectangle {
    const physicalObjects = Array.from(this.project.stage).filter((node) => node.isPhysical);
    if (physicalObjects.length === 0) {
      return new Rectangle(Vector.getZero(), Vector.getZero());
    }
    const rect = Rectangle.getBoundingRectangle(physicalObjects.map((node) => node.collisionBox.getRectangle()));

    return rect;
  }

  /**
   * 根据位置查找节点，常用于点击事件
   * @param location
   * @returns
   */
  findTextNodeByLocation(location: Vector): TextNode | null {
    for (const node of this.getTextNodes()) {
      if (node.collisionBox.isContainsPoint(location)) {
        return node;
      }
    }
    return null;
  }

  /**
   * 用于鼠标悬停时查找边
   * @param location
   * @returns
   */
  findLineEdgeByLocation(location: Vector): LineEdge | null {
    for (const edge of this.getLineEdges()) {
      if (edge.collisionBox.isContainsPoint(location)) {
        return edge;
      }
    }
    return null;
  }

  findAssociationByLocation(location: Vector): Association | null {
    for (const association of this.getAssociations()) {
      if (association.collisionBox.isContainsPoint(location)) {
        return association;
      }
    }
    return null;
  }

  findSectionByLocation(location: Vector): Section | null {
    for (const section of this.getSections()) {
      if (section.collisionBox.isContainsPoint(location)) {
        return section;
      }
    }
    return null;
  }

  findImageNodeByLocation(location: Vector): ImageNode | null {
    for (const node of this.getImageNodes()) {
      if (!node.isBackground && node.collisionBox.isContainsPoint(location)) {
        return node;
      }
    }
    return null;
  }

  findConnectableEntityByLocation(location: Vector): ConnectableEntity | null {
    return this.findEntityInHierarchyByLocation(
      this.topLevelEntities,
      location,
      (entity): entity is ConnectableEntity => entity instanceof ConnectableEntity,
      false,
      false,
    );
  }

  /**
   * 优先级：
   * 涂鸦 > 其他
   * @param location
   * @returns
   */
  findEntityByLocation(location: Vector): Entity | null {
    const hit = this.findEntityInHierarchyByLocation(
      this.topLevelEntities,
      location,
      (entity): entity is Entity => entity instanceof Entity,
      true,
      false,
    );
    if (hit) return hit;

    // 缩小时仍保留至少 6 个屏幕像素的边框命中容差。
    const scale = this.project.camera?.currentScale ?? 1;
    let nearestDistance = 6 / scale;
    let nearest: Section | null = null;
    for (const section of this.getSections()) {
      if (section.isCollapsed || section.isHiddenBySectionCollapse) continue;
      const distance = section.distanceToBorder(location);
      if (
        distance > nearestDistance ||
        (distance === nearestDistance && nearest && section.sectionDepth < nearest.sectionDepth)
      )
        continue;
      if (this.project.sectionMethods.getBigTitleCoveringAncestorSection(section)) continue;
      nearestDistance = distance;
      nearest = section;
    }
    return nearest;
  }

  private findEntityInHierarchyByLocation<T extends Entity>(
    entities: Entity[],
    location: Vector,
    accept: (entity: Entity) => entity is T,
    prioritizePenStroke: boolean,
    sectionOnlyMode: boolean,
  ): T | null {
    if (prioritizePenStroke && !sectionOnlyMode) {
      for (let i = entities.length - 1; i >= 0; i--) {
        const entity = entities[i];
        if (!(entity instanceof PenStroke)) {
          continue;
        }
        if (entity.isHiddenBySectionCollapse) {
          continue;
        }
        if (entity.collisionBox.isContainsPoint(location)) {
          return accept(entity) ? entity : null;
        }
      }
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i];
      if (entity.isHiddenBySectionCollapse) {
        continue;
      }
      if (entity instanceof ImageNode && entity.isBackground) {
        continue;
      }
      if (sectionOnlyMode && !(entity instanceof Section)) {
        continue;
      }
      if (prioritizePenStroke && entity instanceof PenStroke) {
        continue;
      }

      if (entity instanceof Section) {
        if (entity.rectangle.isPointIn(location)) {
          const isBigTitleActive = this.project.sectionMethods.isSectionBigTitleActive(entity);
          if (isBigTitleActive && accept(entity)) {
            return entity;
          }
          const nextSectionOnlyMode = sectionOnlyMode || isBigTitleActive;
          if (!nextSectionOnlyMode) {
            const childHit = this.findEntityInHierarchyByLocation(
              entity.children,
              location,
              accept,
              prioritizePenStroke,
              false,
            );
            if (childHit) {
              return childHit;
            }
          }
        }
        if (accept(entity) && entity.collisionBox.isContainsPoint(location)) {
          return entity;
        }
        continue;
      }

      if (accept(entity) && entity.collisionBox.isContainsPoint(location)) {
        return entity;
      }
    }
    return null;
  }

  findConnectPointByLocation(location: Vector): ConnectPoint | null {
    for (const point of this.getConnectPoints()) {
      if (point.isHiddenBySectionCollapse) {
        continue;
      }
      if (point.collisionBox.isContainsPoint(location)) {
        return point;
      }
    }
    return null;
  }
  isHaveEntitySelected(): boolean {
    for (const entity of this.getEntities()) {
      if (entity.isSelected) {
        return true;
      }
    }
    return false;
  }

  /**
   * O(n)
   * @returns
   */
  getSelectedEntities(): Entity[] {
    return this.project.stage.filter(
      (so) => so.isSelected && so instanceof Entity && !(so instanceof ImageNode && (so as ImageNode).isBackground),
    ) as Entity[];
  }
  getSelectedAssociations(): Association[] {
    return this.project.stage.filter((so) => so.isSelected && so instanceof Association) as Association[];
  }
  getSelectedStageObjects(): StageObject[] {
    const result: StageObject[] = [];
    result.push(...this.getSelectedEntities());
    result.push(...this.getSelectedAssociations());
    return result;
  }

  getSelectionSummary(): string {
    const entities = this.getSelectedEntities();
    return [
      entities.length,
      entities.filter((entity) => entity instanceof ConnectableEntity).length,
      entities.filter((entity) => entity instanceof TextNode).length,
      entities.filter((entity) => entity instanceof Section).length,
      this.getSelectedAssociations().length,
    ].join(":");
  }

  /**
   * 获取选中内容的边界矩形
   * @returns
   */
  getBoundingBoxOfSelected(): Rectangle {
    const selectedObjects = this.getSelectedStageObjects();
    if (selectedObjects.length === 0) {
      // 如果没有选中任何对象，返回一个默认的矩形
      return new Rectangle(Vector.getZero(), new Vector(100, 100));
    }

    const rectangles = selectedObjects.map((obj) => obj.collisionBox.getRectangle());
    return Rectangle.getBoundingRectangle(rectangles);
  }

  /**
   * 判断某一点是否有实体存在（排除实体的被Section折叠）
   * @param location
   * @returns
   */
  isEntityOnLocation(location: Vector): boolean {
    for (const entity of this.getEntities()) {
      if (entity.isHiddenBySectionCollapse) {
        continue;
      }
      if (entity instanceof ImageNode && entity.isBackground) {
        continue;
      }
      if (entity.collisionBox.isContainsPoint(location)) {
        return true;
      }
    }
    return false;
  }
  isAssociationOnLocation(location: Vector): boolean {
    for (const association of this.getAssociations()) {
      if (association instanceof Edge) {
        if (association.target.isHiddenBySectionCollapse && association.source.isHiddenBySectionCollapse) {
          continue;
        }
      }
      if (association.collisionBox.isContainsPoint(location)) {
        return true;
      }
    }
    return false;
  }

  // region 以下为舞台操作相关的函数
  // 建议不同的功能分类到具体的文件中，然后最后集中到这里调用，使得下面的显示简短一些
  // 每个操作函数尾部都要加一个记录历史的操作

  deleteEntities(deleteNodes: Entity[]) {
    if (deleteNodes.length === 0) {
      // 此处return 性能优化60ms
      return;
    }
    this.project.deleteManager.deleteEntities(deleteNodes);
    this.project.historyManager.recordStep();
  }

  /**
   * 外部的交互层的delete键可以直接调用这个函数
   */
  deleteSelectedStageObjects() {
    const selectedEntities = this.getEntities().filter((node) => node.isSelected);

    // 检查选中的实体是否在锁定的 section 内，或者实体本身是否是锁定的 section，或者是背景图片
    const filteredEntities = selectedEntities.filter((entity) => {
      return (
        !this.project.sectionMethods.isObjectBeLockedBySection(entity) &&
        !(entity instanceof ImageNode && entity.isBackground)
      );
    });

    for (const entity of filteredEntities) {
      if (entity instanceof PenStroke) {
        this.project.effects.addEffect(PenStrokeDeletedEffect.fromPenStroke(entity));
      } else {
        this.project.effects.addEffect(EntityShrinkEffect.fromEntity(entity));
      }
    }

    const parentSet = new Set<ConnectableEntity>();
    for (const entity of filteredEntities) {
      if (entity instanceof ConnectableEntity) {
        for (const parent of this.project.graphMethods.nodeParentArray(entity)) {
          parentSet.add(parent);
        }
      }
    }

    this.project.historyManager.batch(() => {
      this.deleteEntities(filteredEntities);
      for (const association of this.getAssociations()) {
        if (!association.isSelected || this.project.sectionMethods.isObjectBeLockedBySection(association)) continue;
        if (!this.deleteAssociation(association)) continue;
        if (association instanceof Edge) {
          this.project.effects.addEffects(this.project.edgeRenderer.getCuttingEffects(association));
        }
      }
    });
    // feature：delete键删除的时候，如果有父节点，让选中状态移动到父节点上
    if (parentSet.size > 0) {
      const firstParent = parentSet.values().next().value;
      if (firstParent) {
        firstParent.isSelected = true;
      }
    }
  }
  deleteAssociation(deleteAssociation: Association): boolean {
    if (deleteAssociation instanceof Edge) {
      return this.deleteEdge(deleteAssociation);
    } else if (deleteAssociation instanceof MultiTargetUndirectedEdge) {
      const res = this.project.deleteManager.deleteMultiTargetUndirectedEdge(deleteAssociation);
      if (res) this.project.historyManager.recordStep();
      return res;
    }
    toast.error("无法删除未知类型的关系");
    return false;
  }

  deleteEdge(deleteEdge: Edge): boolean {
    const res = this.project.deleteManager.deleteEdge(deleteEdge);
    if (res) this.project.historyManager.recordStep();
    return res;
  }

  // 一个简单的文案
  private static w = `自环已被禁止，可在设置>控制>连线 中打开允许添加自环选项，
    但您可能并不是想添加自环，您可能是想打开右键菜单，所以请在空白位置右键。
    如果您不需要添加自环的操作但想保持能够通过在节点上右键打开菜单的操作，
    可在设置>控制>连线 中关闭“启用右键点击连线功能”。
    但如果您既要右键点击节点创建连线功能，又想要在节点上右键展开右键菜单操作，很抱歉，这两个功能在逻辑上冲突了。
    `;

  connectEntity(fromNode: ConnectableEntity, toNode: ConnectableEntity, isCrEdge: boolean = false) {
    if (fromNode === toNode && !Settings.allowAddCycleEdge) {
      toast.warning(
        <div>
          <span>{StageManager.w}</span>
        </div>,
      );
      return false;
    }
    if (isCrEdge) {
      this.project.nodeConnector.addCrEdge(fromNode, toNode);
    } else {
      this.project.nodeConnector.connectConnectableEntity(fromNode, toNode);
    }

    this.project.historyManager.recordStep();
    return this.project.graphMethods.isConnected(fromNode, toNode);
  }

  /**
   * 多重连接，只记录一次历史
   * @param fromNodes
   * @param toNode
   * @param isCrEdge
   * @returns
   */
  connectMultipleEntities(
    fromNodes: ConnectableEntity[],
    toNode: ConnectableEntity,
    isCrEdge: boolean = false,
    sourceRectRate?: [number, number],
    targetRectRate?: [number, number],
    isArcEdge: boolean = false,
  ) {
    if (fromNodes.length === 0) {
      return false;
    }
    for (const fromNode of fromNodes) {
      if (fromNode === toNode && !Settings.allowAddCycleEdge) {
        toast.warning(
          <div>
            <h2 className="text-xl">请在空白处右键</h2>
            <span>{StageManager.w}</span>
          </div>,
        );
        continue;
      }
      if (isArcEdge) {
        this.project.nodeConnector.addArcEdge(fromNode, toNode);
      } else if (isCrEdge) {
        this.project.nodeConnector.addCrEdge(fromNode, toNode);
      } else {
        this.project.nodeConnector.connectConnectableEntity(fromNode, toNode, "", targetRectRate, sourceRectRate);
      }
    }
    this.project.historyManager.recordStep();
    return true;
  }

  reverseSelectedEdges() {
    const selectedEdges = this.getLineEdges().filter((edge) => edge.isSelected);
    if (selectedEdges.length === 0) {
      return;
    }
    this.project.nodeConnector.reverseEdges(selectedEdges);
  }

  // addSerializedData(serializedData: Serialized.File, diffLocation = new Vector(0, 0)) {
  //   this.project.serializedDataAdder.addSerializedData(serializedData, diffLocation);
  //   this.project.historyManager.recordStep();
  // }

  generateNodeTreeByText(
    text: string,
    indention: number = 4,
    location = this.project.camera.location,
    mindMap = false,
  ) {
    this.project.nodeAdder.addNodeTreeByText(text, indention, location, mindMap);
    this.project.historyManager.recordStep();
  }

  generateNodeGraphByText(text: string, location = this.project.camera.location) {
    try {
      this.project.nodeAdder.addNodeGraphByText(text, location);
      this.project.historyManager.recordStep();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  generateNodeMermaidByText(text: string, location = this.project.camera.location) {
    try {
      this.project.nodeAdder.addNodeMermaidByText(text, location);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  generateNodeByMarkdown(text: string, location = this.project.camera.location, autoLayout = true) {
    this.project.nodeAdder.addNodeByMarkdown(text, location, autoLayout);
  }

  /** 将多个实体打包成一个section，并添加到舞台中 */
  packEntityToSection(addEntities: Entity[]) {
    this.project.sectionPackManager.packEntityToSection(addEntities);
  }

  /** 将选中的实体打包成一个section，并添加到舞台中 */
  packEntityToSectionBySelected() {
    const selectedNodes = this.getSelectedEntities();
    if (selectedNodes.length === 0) {
      return;
    }
    this.packEntityToSection(selectedNodes);
  }

  goInSection(entities: Entity[], section: Section) {
    this.project.sectionInOutManager.goInSection(entities, section);
    this.project.historyManager.recordStep();
  }

  goOutSection(entities: Entity[], section: Section) {
    this.project.sectionInOutManager.goOutSection(entities, section);
    this.project.historyManager.recordStep();
  }
  /** 将所有选中的Section折叠起来 */
  packSelectedSection() {
    this.project.sectionPackManager.packSection();
    this.project.historyManager.recordStep();
  }

  /** 将所有选中的Section展开 */
  unpackSelectedSection() {
    this.project.sectionPackManager.unpackSection();
    this.project.historyManager.recordStep();
  }

  /**
   * 切换选中的Section的折叠状态
   */
  sectionSwitchCollapse() {
    this.project.sectionPackManager.switchCollapse();
    this.project.historyManager.recordStep();
  }

  connectEntityByCrEdge(fromNode: ConnectableEntity, toNode: ConnectableEntity) {
    return this.project.nodeConnector.addCrEdge(fromNode, toNode);
  }

  /**
   * 刷新所有舞台内容
   */
  refreshAllStageObjects() {
    const entities = this.getEntities();
    for (const entity of entities) {
      if (entity instanceof TextNode) {
        if (entity.sizeAdjust === "auto") {
          entity.forceAdjustSizeByText();
        }
      } else if (entity instanceof Section) {
        entity.adjustLocationAndSize();
      }
    }
  }

  /**
   * 刷新选中内容
   */
  refreshSelected() {
    const entities = this.getSelectedEntities();
    for (const entity of entities) {
      if (entity instanceof ImageNode) {
        // entity.refresh();
      }
    }
  }

  /**
   * 改变连线的目标接头点位置
   * @param direction
   */
  changeSelectedEdgeConnectLocation(direction: Direction | null, isSource: boolean = false) {
    const edges = this.getSelectedAssociations().filter((edge) => edge instanceof Edge);
    this.changeEdgesConnectLocation(edges, direction, isSource);
    if (edges.length > 0) this.project.historyManager.recordStep();
  }

  changeSelectedEdgeConnectLocations(source: Direction | null, target: Direction | null) {
    const edges = this.getSelectedAssociations().filter((edge) => edge instanceof Edge);
    if (edges.length === 0) return;
    this.changeEdgesConnectLocation(edges, source, true);
    this.changeEdgesConnectLocation(edges, target);
    this.project.historyManager.recordStep();
  }

  /**
   * 更改多个连线的目标接头点位置
   * @param edges
   * @param direction
   * @param isSource
   */
  changeEdgesConnectLocation(edges: Edge[], direction: Direction | null, isSource = false, fixEndpoints = true) {
    const newLocationRate = new Vector(0.5, 0.5);
    if (direction === Direction.Left) {
      newLocationRate.x = 0.01;
    } else if (direction === Direction.Right) {
      newLocationRate.x = 0.99;
    } else if (direction === Direction.Up) {
      newLocationRate.y = 0.01;
    } else if (direction === Direction.Down) {
      newLocationRate.y = 0.99;
    }

    for (const edge of edges) {
      if (isSource) {
        edge.sourceRectangleRate = newLocationRate;
      } else {
        edge.targetRectangleRate = newLocationRate;
      }
      if (edge instanceof LineEdge) {
        if (direction !== null && fixEndpoints) edge.fixedEndpoints = true;
        else if (edge.isUnknownDirection()) edge.fixedEndpoints = undefined;
      }
    }
    // 播放连线调整音效
    SoundService.play.associationAdjustSoundFile();
  }

  switchLineEdgeToCrEdge() {
    const prepareDeleteLineEdge: LineEdge[] = [];
    for (const edge of this.getLineEdges()) {
      if (edge instanceof LineEdge && edge.isSelected) {
        // 删除这个连线，并准备创建cr曲线
        prepareDeleteLineEdge.push(edge);
      }
    }
    this.project.historyManager.batch(() => {
      for (const lineEdge of prepareDeleteLineEdge) {
        if (!this.deleteEdge(lineEdge)) continue;
        this.connectEntityByCrEdge(lineEdge.source, lineEdge.target);
      }
    });
  }

  /**
   * 有向边转无向边
   */
  switchEdgeToUndirectedEdge() {
    const prepareDeleteLineEdge: LineEdge[] = [];
    for (const edge of this.getLineEdges()) {
      if (edge instanceof LineEdge && edge.isSelected) {
        // 删除这个连线，并准备创建
        prepareDeleteLineEdge.push(edge);
      }
    }
    this.project.historyManager.batch(() => {
      for (const edge of prepareDeleteLineEdge) {
        if (edge.target === edge.source || !this.deleteEdge(edge)) continue;
        const undirectedEdge = MultiTargetUndirectedEdge.createFromSomeEntity(this.project, [edge.target, edge.source]);
        undirectedEdge.text = edge.text;
        undirectedEdge.color = edge.color.clone();
        undirectedEdge.arrow = "outer";
        this.add(undirectedEdge);
      }
    });
  }
  /**
   * 有向边转弧形边
   */
  switchEdgeToArcEdge() {
    const prepareConvert: LineEdge[] = [];
    for (const edge of this.getLineEdges()) {
      if (edge.isSelected) {
        prepareConvert.push(edge);
      }
    }
    this.project.historyManager.batch(() => {
      for (const edge of prepareConvert) {
        if (edge.target === edge.source || !this.deleteEdge(edge)) continue;
        const arcEdge = new ArcEdge(this.project, {
          associationList: [edge.source, edge.target],
          text: edge.text,
          color: edge.color.clone(),
          sourceRectangleRate: edge.sourceRectangleRate.clone(),
          targetRectangleRate: edge.targetRectangleRate.clone(),
          lineType: edge.lineType,
          arrowType: edge.arrowType,
          graphLayout: edge.graphLayout,
          offset: 10,
        });
        this.add(arcEdge);
      }
    });
  }
  /**
   * 无向边转有向边
   */
  switchUndirectedEdgeToEdge() {
    const prepareDeleteUndirectedEdge: MultiTargetUndirectedEdge[] = [];
    for (const edge of this.getAssociations()) {
      if (edge instanceof MultiTargetUndirectedEdge && edge.isSelected) {
        // 删除这个连线，并准备创建
        prepareDeleteUndirectedEdge.push(edge);
      }
    }
    this.project.historyManager.batch(() => {
      for (const edge of prepareDeleteUndirectedEdge) {
        if (edge.associationList.length !== 2) continue;
        const [fromNode, toNode] = edge.associationList;
        if (!(fromNode instanceof ConnectableEntity && toNode instanceof ConnectableEntity)) continue;
        if (!this.deleteAssociation(edge)) continue;
        const lineEdge = LineEdge.fromTwoEntity(this.project, fromNode, toNode);
        lineEdge.text = edge.text;
        lineEdge.color = edge.color.clone();
        this.add(lineEdge);
      }
    });
  }

  addSelectedCREdgeControlPoint() {
    const selectedCREdge = this.getSelectedAssociations().filter((edge) => edge instanceof CubicCatmullRomSplineEdge);
    for (const edge of selectedCREdge) {
      edge.addControlPoint();
    }
  }

  addSelectedCREdgeTension() {
    const selectedCREdge = this.getSelectedAssociations().filter((edge) => edge instanceof CubicCatmullRomSplineEdge);
    for (const edge of selectedCREdge) {
      edge.tension += 0.25;
      edge.tension = Math.min(1, edge.tension);
    }
  }

  reduceSelectedCREdgeTension() {
    const selectedCREdge = this.getSelectedAssociations().filter((edge) => edge instanceof CubicCatmullRomSplineEdge);
    for (const edge of selectedCREdge) {
      edge.tension -= 0.25;
      edge.tension = Math.max(0, edge.tension);
    }
  }

  /**
   * 设置选中Edge的线条类型
   */
  setSelectedEdgeLineType(lineType: string) {
    const selectedEdges = this.getSelectedAssociations().filter(
      (edge) => edge instanceof LineEdge || edge instanceof ArcEdge || edge instanceof MultiTargetUndirectedEdge,
    );
    for (const edge of selectedEdges) {
      (edge as LineEdge | ArcEdge | MultiTargetUndirectedEdge).lineType = lineType;
    }
  }

  /**
   * 设置选中Edge的箭头类型
   */
  setSelectedEdgeArrowType(arrowType: string) {
    const selectedEdges = this.getSelectedAssociations().filter(
      (edge) => edge instanceof LineEdge || edge instanceof ArcEdge || edge instanceof MultiTargetUndirectedEdge,
    );
    for (const edge of selectedEdges) {
      (edge as LineEdge | ArcEdge | MultiTargetUndirectedEdge).arrowType = arrowType;
    }
  }

  selectAll(): "local" | "global" {
    const stage = this.project.stage;
    const scope = this.selectAllScope;
    if (scope && stage.every((object) => object.isSelected === scope.objects.has(object))) {
      if (scope.kind !== "downstream") return "local";
      this.selectAllScope = { objects: this.getConnectedNodes("both"), kind: "connected" };
    } else {
      this.selectAllScope = null;
      if (stage.every((object) => object.isSelected)) return "global";
      const sections = this.getSections().filter((section) => section.isSelected);
      if (sections.length > 0) {
        const objects = this.getSectionContents(sections);
        if (objects.size === 0) return "local";
        this.selectAllScope = { objects, kind: "section" };
      } else {
        const objects = this.getConnectedNodes("outgoing");
        if (objects.size > 0) this.selectAllScope = { objects, kind: "downstream" };
        else if (stage.some((object) => object.isSelected)) return "local";
      }
    }

    const local = this.selectAllScope?.objects;
    for (const object of stage) object.isSelected = !local || local.has(object);
    return local ? "local" : "global";
  }

  private getSectionContents(sections: Section[]): Set<StageObject> {
    const children = sections.flatMap((section) => section.children);
    const contents = new Set<StageObject>(
      this.project.sectionMethods.getAllEntitiesInSelectedSectionsOrEntities(children),
    );
    for (const relation of this.getAssociations()) {
      if (
        relation instanceof ConnectableAssociation &&
        relation.isPhysical &&
        relation.associationList.length > 0 &&
        relation.associationList.every((endpoint) => contents.has(endpoint))
      ) {
        contents.add(relation);
      }
    }
    return contents;
  }

  private getConnectedNodes(direction: "outgoing" | "both"): Set<StageObject> {
    const nodes = this.getConnectableEntity().filter((node) => !node.isHiddenBySectionCollapse);
    const queue = nodes.filter((node) => node.isSelected);
    const selected = new Set<StageObject>(queue);
    if (queue.length === 0) return selected;

    const visibleNodes = new Set(nodes);
    const relationsByNode = new Map<ConnectableEntity, ConnectableAssociation[]>();
    for (const relation of this.getAssociations()) {
      if (!(relation instanceof ConnectableAssociation) || !relation.isPhysical) continue;
      const endpoints = relation.associationList;
      if (endpoints.length < 2 || !endpoints.every((node) => visibleNodes.has(node))) continue;
      for (const node of direction === "outgoing" && relation instanceof Edge ? [relation.source] : endpoints) {
        const relations = relationsByNode.get(node);
        if (relations) relations.push(relation);
        else relationsByNode.set(node, [relation]);
      }
    }

    const visitedRelations = new Set<ConnectableAssociation>();
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      for (const relation of relationsByNode.get(node) ?? []) {
        if (visitedRelations.has(relation)) continue;
        visitedRelations.add(relation);
        for (const other of relation.associationList) {
          if (selected.has(other)) continue;
          selected.add(other);
          queue.push(other);
        }
      }
    }
    return selected;
  }

  clearSelectAll() {
    this.selectAllScope = null;
    for (const entity of this.project.stage) {
      entity.isSelected = false;
    }
  }
}
