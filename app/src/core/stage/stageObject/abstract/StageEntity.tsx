import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { StageObject } from "@/core/stage/stageObject/abstract/StageObject";
import type { Section } from "@/core/stage/stageObject/entity/Section";
import { Vector } from "@graphif/data-structures";
import { serializable } from "@graphif/serializer";
import { Circle, Rectangle } from "@graphif/shapes";
import type { Value } from "platejs";
import { DetailsManager } from "../tools/entityDetailsManager";
/**
 * 一切独立存在、能被移动的东西，且放在框里能被连带移动的东西
 * 实体
 */
export abstract class Entity extends StageObject {
  private static readonly collisionPasses = new WeakMap<Project, { pending: Entity[]; moved: Set<Entity> }>();

  /**
   * 将某个物体移动某个距离
   * @param delta
   */
  abstract move(delta: Vector): void;

  /**
   * 是否忽略自动对齐功能
   * 例如涂鸦就不吸附对齐
   */
  public isAlignExcluded = false;
  /**
   * 将某个物体移动到某个位置
   * 注意：看的是最小外接矩形的左上角位置，不是中心位置
   * @param location
   */
  abstract moveTo(location: Vector): void;

  /**
   * [
   *  { type: 'p', children: [{ text: 'Serialize just this paragraph.' }] },
   *  { type: 'h1', children: [{ text: 'And this heading.' }] }
   * ]
   */
  @serializable
  public details: Value = [];

  /**
   * 运行时直接父级 Section。
   * 不参与序列化，打开文件后由 `StageManager.updateReferences()` 重建。
   */
  public parentSection: Section | null = null;

  /**
   * 运行时层级深度。
   * 顶层实体和根 Section 都为 0，嵌套越深数值越大。
   */
  public sectionDepth: number = 0;

  /**
   * 运行时最近的锁定祖先 Section。
   * 沿父链读取当前状态，避免锁定切换后缓存过期。
   */
  public get nearestLockedAncestorSection(): Section | null {
    let current = this.parentSection;
    while (current) {
      if (current.locked) return current;
      current = current.parentSection;
    }
    return null;
  }

  /** 用于交互使用，比如鼠标悬浮显示details */
  public isMouseHover: boolean = false;

  public detailsButtonRectangle(): Rectangle {
    const thisRectangle = this.collisionBox.getRectangle();
    return new Rectangle(thisRectangle.rightTop.subtract(new Vector(10, 10)), new Vector(25, 25));
  }
  public isMouseInDetailsButton(mouseWorldLocation: Vector): boolean {
    return this.detailsButtonRectangle().isPointIn(mouseWorldLocation);
  }

  public referenceButtonCircle(): Circle {
    const thisRectangle = this.collisionBox.getRectangle();
    return new Circle(thisRectangle.leftTop.subtract(new Vector(25, 25)), 25);
  }
  public isMouseInReferenceButton(mouseWorldLocation: Vector): boolean {
    return this.referenceButtonCircle().isPointIn(mouseWorldLocation);
  }

  /**
   * 由于自身位置的移动，递归的更新所有父级Section的位置和大小。
   * 每次父框 adjustLocationAndSize 后，调用碰撞求解器推开与其重叠的同级分支。
   */
  protected updateFatherSectionByMove(checkPlacement = false) {
    if (this.project.sectionMoveDepth > 0) return;
    const parent = this.parentSection;
    if (!parent) return;
    const solver = this.project.sectionCollisionSolver;
    const before =
      checkPlacement && !this.project.deferredMoveCollisions ? solver?.getPlacementBounds(parent) : undefined;
    let current = this.parentSection;
    while (current) {
      current.adjustLocationAndSize();
      if (!before) solver?.solveOverlaps(current);
      current = current.parentSection;
    }
    if (before) solver.solvePlacement(parent, before);
  }
  /**
   * 由于自身位置的更新，排开所有同级节点的位置
   * 此函数在move函数中被调用，更新
   */
  protected updateOtherEntityLocationByMove() {
    if (this.project.sectionMoveDepth > 0) return;

    const project = this.project;
    const currentPass = Entity.collisionPasses.get(project);
    if (currentPass) {
      currentPass.pending.push(this);
      return;
    }
    if (project.deferredMoveCollisions) {
      project.deferredMoveCollisions.entities.add(this);
      return;
    }
    Entity.resolveMoveCollisions(project, [this]);
  }

  static resolveMoveCollisions(
    project: Project,
    sources: Entity[],
    protectedEntities: Iterable<Entity> = sources,
    candidates?: readonly Entity[],
  ) {
    if (!Settings.isEnableEntityCollision || sources.length === 0) return;

    const pass = { pending: sources, moved: new Set(protectedEntities) };
    for (const source of sources) pass.moved.add(source);
    Entity.collisionPasses.set(project, pass);
    try {
      const entities = candidates ?? project.stageManager.getEntities();
      for (const source of pass.pending) {
        for (const entity of entities) {
          if (!pass.moved.has(entity)) source.collideWithOtherEntity(entity);
        }
      }
    } finally {
      Entity.collisionPasses.delete(project);
    }
  }

  protected get collisionMargin(): number {
    return 0;
  }

  /**
   * 与其他实体碰撞，调整位置
   * @param other 其他实体
   */
  protected collideWithOtherEntity(other: Entity) {
    if (!Settings.isEnableEntityCollision) {
      return;
    }
    const bounds = this.collisionBox.getRectangle();
    const margin =
      this.parentSection === other.parentSection ? Math.max(this.collisionMargin, other.collisionMargin) : 0;
    const selfRectangle = margin > 0 ? bounds.expandFromCenter(margin) : bounds;
    const otherRectangle = other.collisionBox.getRectangle();
    if (!selfRectangle.isCollideWith(otherRectangle)) {
      return;
    }

    const moveDelta = Entity.getCollisionPushDelta(selfRectangle, otherRectangle);
    // 分组框会在子节点移动后重算大小，可能与已经推开的节点再次重叠。
    Entity.collisionPasses.get(this.project)?.moved.add(other);
    other.move(moveDelta);
  }

  static getCollisionPushDelta(selfRectangle: Rectangle, otherRectangle: Rectangle): Vector {
    // 完全包含时，只按相交宽高推移无法分开，因此直接计算到对侧边界的距离。
    const dx =
      otherRectangle.center.x >= selfRectangle.center.x
        ? selfRectangle.right - otherRectangle.left
        : selfRectangle.left - otherRectangle.right;
    const dy =
      otherRectangle.center.y >= selfRectangle.center.y
        ? selfRectangle.bottom - otherRectangle.top
        : selfRectangle.top - otherRectangle.bottom;
    return Math.abs(dx) < Math.abs(dy) ? new Vector(dx, 0) : new Vector(0, dy);
  }
  /**
   * 是不是因为所在的Section被折叠而隐藏了
   * 因为任何Entity都可以放入Section
   */
  abstract isHiddenBySectionCollapse: boolean;

  // 桥接模式，让详细信息的各种操作封装在外部类中
  public detailsManager = new DetailsManager(this);
}
