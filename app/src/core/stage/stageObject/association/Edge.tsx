import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Direction } from "@/types/directions";
import { Vector } from "@graphif/data-structures";
import { serializable } from "@graphif/serializer";
import { Line, Rectangle } from "@graphif/shapes";
import { ConnectPoint } from "../entity/ConnectPoint";

export type PreservedGraphLayout = "dag" | "fishbone" | "mindMap";

/**
 * 连接两个实体的有向边
 */
export abstract class Edge extends ConnectableAssociation {
  public abstract uuid: string;
  /**
   * 线段上的文字
   */
  public abstract text: string;
  abstract collisionBox: CollisionBox;

  @serializable
  public graphLayout?: PreservedGraphLayout;

  get isHiddenBySectionCollapse(): boolean {
    return this.source.isHiddenBySectionCollapse && this.target.isHiddenBySectionCollapse;
  }

  /** region 选中状态 */
  /**
   * 是否被选中
   */
  _isSelected: boolean = false;
  public get isSelected(): boolean {
    return this._isSelected;
  }
  public set isSelected(value: boolean) {
    this._isSelected = value;
  }

  /**
   * 任何有向边都可以标注文字
   * 进而获得该文字的外框矩形
   */
  abstract get textRectangle(): Rectangle;

  private bodyLineCache?: {
    source: ConnectableEntity;
    target: ConnectableEntity;
    sourceRectangle: Rectangle;
    targetRectangle: Rectangle;
    savedSourceRate: Vector;
    savedTargetRate: Vector;
    adjustSides: boolean;
    sourceRate: Vector;
    targetRate: Vector;
    line: Line;
  };

  protected get adjustBodyLineSides(): boolean {
    return false;
  }

  /**
   * 获取两个实体之间的直线
   * 此直线两端在两个实体外接矩形的边缘，延长后可过两个实体外接矩形的中心
   * 但对于图片节点，如果rate是精确值（不是旧的默认值），则直接使用内部位置
   */
  get bodyLine(): Line {
    return this.bodyLineGeometry.line;
  }

  get bodyLineGeometry(): { line: Line; sourceRate: Vector; targetRate: Vector } {
    const sourceRectangle = this.source.collisionBox.getRectangle();
    const targetRectangle = this.target.collisionBox.getRectangle();
    const adjustSides = this.adjustBodyLineSides;

    const cached = this.bodyLineCache;
    if (
      cached &&
      cached.source === this.source &&
      cached.target === this.target &&
      cached.sourceRectangle.location.equals(sourceRectangle.location) &&
      cached.sourceRectangle.size.equals(sourceRectangle.size) &&
      cached.targetRectangle.location.equals(targetRectangle.location) &&
      cached.targetRectangle.size.equals(targetRectangle.size) &&
      cached.savedSourceRate.equals(this.sourceRectangleRate) &&
      cached.savedTargetRate.equals(this.targetRectangleRate) &&
      cached.adjustSides === adjustSides
    )
      return cached;

    let sourceRate = this.sourceRectangleRate.clone();
    let targetRate = this.targetRectangleRate.clone();
    const isCenterRate = (rate: Vector): boolean => rate.x === 0.5 && rate.y === 0.5;
    if (adjustSides) {
      const horizontal =
        Number(targetRectangle.left > sourceRectangle.right) - Number(sourceRectangle.left > targetRectangle.right);
      const vertical =
        Number(targetRectangle.top > sourceRectangle.bottom) - Number(sourceRectangle.top > targetRectangle.bottom);
      const facesNeighbor = (rate: Vector, x: number, y: number) =>
        isCenterRate(rate) || (rate.x - 0.5) * x + (rate.y - 0.5) * y > 0;
      if (!facesNeighbor(sourceRate, horizontal, vertical) || !facesNeighbor(targetRate, -horizontal, -vertical)) {
        // 两轴均有空隙时优先沿用原端点的轴，避免斜拖时来回换边。
        const preferredRate = isCenterRate(sourceRate) ? targetRate : sourceRate;
        if (horizontal !== 0 && (preferredRate.y === 0.5 || vertical === 0)) {
          sourceRate = new Vector(horizontal > 0 ? 0.99 : 0.01, 0.5);
          targetRate = new Vector(horizontal > 0 ? 0.01 : 0.99, 0.5);
        } else if (vertical !== 0) {
          sourceRate = new Vector(0.5, vertical > 0 ? 0.99 : 0.01);
          targetRate = new Vector(0.5, vertical > 0 ? 0.01 : 0.99);
        }
      }
    }

    const sourceInner = sourceRectangle.getInnerLocationByRateVector(sourceRate);
    const targetInner = targetRectangle.getInnerLocationByRateVector(targetRate);
    const edgeCenterLine = new Line(sourceInner, targetInner);
    let startPoint: Vector;
    let endPoint: Vector;

    if (this.source instanceof ConnectPoint) {
      startPoint = this.source.geometryCenter;
    } else if (!isCenterRate(sourceRate)) {
      startPoint =
        Edge.getExactEdgePositionByRate(sourceRectangle, sourceRate) ??
        (this.source.clipConnectionToBoundary ? sourceRectangle.getLineIntersectionPoint(edgeCenterLine) : sourceInner);
    } else {
      // Center rate: clip to the bounding rectangle edge along the connection direction
      startPoint = sourceRectangle.getLineIntersectionPoint(edgeCenterLine);
    }
    if (this.target instanceof ConnectPoint) {
      endPoint = this.target.geometryCenter;
    } else if (!isCenterRate(targetRate)) {
      endPoint =
        Edge.getExactEdgePositionByRate(targetRectangle, targetRate) ??
        (this.target.clipConnectionToBoundary ? targetRectangle.getLineIntersectionPoint(edgeCenterLine) : targetInner);
    } else {
      // Center rate: clip to the bounding rectangle edge along the connection direction
      endPoint = targetRectangle.getLineIntersectionPoint(edgeCenterLine);
    }
    const line = new Line(startPoint, endPoint);
    this.bodyLineCache = {
      source: this.source,
      target: this.target,
      sourceRectangle: sourceRectangle.clone(),
      targetRectangle: targetRectangle.clone(),
      savedSourceRate: this.sourceRectangleRate.clone(),
      savedTargetRate: this.targetRectangleRate.clone(),
      adjustSides,
      sourceRate,
      targetRate,
      line,
    };
    return this.bodyLineCache;
  }

  /**
   * 获取该连线的起始点位置对应的世界坐标
   */
  get sourceLocation(): Vector {
    return this.source.collisionBox.getRectangle().getInnerLocationByRateVector(this.sourceRectangleRate);
  }
  /**
   * 获取该连线的终止点位置对应的世界坐标
   */
  get targetLocation(): Vector {
    return this.target.collisionBox.getRectangle().getInnerLocationByRateVector(this.targetRectangleRate);
  }

  @serializable
  public targetRectangleRate: Vector = new Vector(0.5, 0.5);
  @serializable
  public sourceRectangleRate: Vector = new Vector(0.5, 0.5);

  /**
   * 静态方法：
   * 获取两个实体外接矩形的连线线段，（只连接到两个边，不连到矩形中心）
   * @param source
   * @param target
   * @returns
   */
  static getCenterLine(source: ConnectableEntity, target: ConnectableEntity): Line {
    const sourceRectangle = source.collisionBox.getRectangle();
    const targetRectangle = target.collisionBox.getRectangle();

    const edgeCenterLine = new Line(sourceRectangle.center, targetRectangle.center);
    const startPoint = sourceRectangle.getLineIntersectionPoint(edgeCenterLine);
    const endPoint = targetRectangle.getLineIntersectionPoint(edgeCenterLine);
    return new Line(startPoint, endPoint);
  }

  /**
   * 根据 rate 向量推算贝塞尔曲线的出发/到达法线方向。
   * rate 直接编码了连接点所在的边，无需依赖点坐标与矩形边的精确相等比较。
   * - rate.x === 0.01 → 左边缘 → (-1, 0)
   * - rate.x === 0.99 → 右边缘 → (1, 0)
   * - rate.y === 0.01 → 上边缘 → (0, -1)
   * - rate.y === 0.99 → 下边缘 → (0, 1)
   * - 其他（中心或图片内部精确位置）→ null，由调用方回退到其他逻辑
   */
  static getNormalVectorByRate(rate: Vector): Vector | null {
    if (rate.x === 0.01) return new Vector(-1, 0);
    if (rate.x === 0.99) return new Vector(1, 0);
    if (rate.y === 0.01) return new Vector(0, -1);
    if (rate.y === 0.99) return new Vector(0, 1);
    return null;
  }

  /**
   * 当 rate 是边缘哨兵值（0.01/0.99）时，返回该边缘的精确中心坐标，
   * 避免 getInnerLocationByRateVector 产生的 width*0.01 偏移在大节点上可见。
   * - rate.x === 0.01 → 左边缘中心
   * - rate.x === 0.99 → 右边缘中心
   * - rate.y === 0.01 → 上边缘中心
   * - rate.y === 0.99 → 下边缘中心
   * - 其他 → null，由调用方使用 getInnerLocationByRateVector 处理
   */
  static getExactEdgePositionByRate(rect: Rectangle, rate: Vector): Vector | null {
    if (rate.x === 0.01) return rect.leftCenter;
    if (rate.x === 0.99) return rect.rightCenter;
    if (rate.y === 0.01) return rect.topCenter;
    if (rate.y === 0.99) return rect.bottomCenter;
    return null;
  }

  /** 线段上的文字相关 */
  /**
   * 调整线段上的文字的外框矩形
   */
  abstract adjustSizeByText(): void;

  public rename(text: string) {
    this.text = text;
    this.adjustSizeByText();
  }

  /** 碰撞相关 */
  /**
   * 用于碰撞箱框选
   * @param rectangle
   */
  public isIntersectsWithRectangle(rectangle: Rectangle): boolean {
    return this.collisionBox.isIntersectsWithRectangle(rectangle);
  }

  /**
   * 用于鼠标悬浮在线上的时候
   * @param location
   * @returns
   */
  public isIntersectsWithLocation(location: Vector): boolean {
    return this.collisionBox.isContainsPoint(location);
  }

  /**
   * 用于线段框选
   * @param line
   * @returns
   */
  public isIntersectsWithLine(line: Line): boolean {
    return this.collisionBox.isIntersectsWithLine(line);
  }

  public isLeftToRight(): boolean {
    return this.sourceRectangleRate.x === 0.99 && this.targetRectangleRate.x === 0.01;
  }
  public isRightToLeft(): boolean {
    return this.sourceRectangleRate.x === 0.01 && this.targetRectangleRate.x === 0.99;
  }

  public isTopToBottom(): boolean {
    return this.sourceRectangleRate.y === 0.99 && this.targetRectangleRate.y === 0.01;
  }
  public isBottomToTop(): boolean {
    return this.sourceRectangleRate.y === 0.01 && this.targetRectangleRate.y === 0.99;
  }

  public getTreeDirection(): Direction | undefined {
    // 使用画布当前的端点方向，拖动节点时无需修改保存的端点。
    const { sourceRate, targetRate } = this.bodyLineGeometry;
    if (sourceRate.x === 0.99 && targetRate.x === 0.01) return Direction.Right;
    if (sourceRate.x === 0.01 && targetRate.x === 0.99) return Direction.Left;
    if (sourceRate.y === 0.99 && targetRate.y === 0.01) return Direction.Down;
    if (sourceRate.y === 0.01 && targetRate.y === 0.99) return Direction.Up;
  }

  public isUnknownDirection(): boolean {
    return (
      this.sourceRectangleRate.x === 0.5 &&
      this.targetRectangleRate.x === 0.5 &&
      this.sourceRectangleRate.y === 0.5 &&
      this.targetRectangleRate.y === 0.5
    );
  }

  /**
   * 是否是非标准连线（端点位置不对应标准四方向，也不是默认中心方向）
   * 例如：右侧发出 + 上侧接收，即混合了不同轴的端点
   */
  public isNonStandardDirection(): boolean {
    return (
      !this.isLeftToRight() &&
      !this.isRightToLeft() &&
      !this.isTopToBottom() &&
      !this.isBottomToTop() &&
      !this.isUnknownDirection()
    );
  }
}
