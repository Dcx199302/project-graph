import { Project, service } from "@/core/Project";
import { easeOutExpo } from "@/core/service/feedbackService/effectEngine/mathTools/easings";
import { Settings } from "@/core/service/Settings";
import { SoundService } from "../service/feedbackService/SoundService";
import { Direction } from "@/types/directions";
import { Queue, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { toast } from "sonner";

type CameraView = { location: Vector; scale: number };

/**
 * 摄像机
 *
 * 该摄像机可以看成是悬浮在空中的，能上下左右四个方向喷气的小型飞机。
 * 喷气的含义是：按下WASD键可以控制四个喷气孔喷气，产生动力，松开立刻失去动力。
 * 同时空气有空气阻力，会对速度的反方向产生阻力。
 * 但滚轮会控制摄像机的缩放镜头。同时缩放大小也会影响喷气动力的大小，越是观看细节，喷的动力越小，移动越慢。
 */
@service("camera")
export class Camera {
  static validScale(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  /**
   * 空气摩擦力速度指数
   * 指数=2，表示 f = -k * v^2
   * 指数=1，表示 f = -k * v
   * 指数越大，速度衰减越快
   */
  readonly frictionExponent = 1.5;

  /**
   * 摄像机的位置（世界坐标）
   * 实际上代表的是 currentLocation
   */
  location: Vector = Vector.getZero();
  /**
   * 上次鼠标缩放滚轮交互位置
   * 世界坐标
   */

  targetLocationByScale: Vector = Vector.getZero();

  /** 当前的 画布/摄像机移动的速度矢量 */
  speed: Vector = Vector.getZero();

  /**
   * 可以看成一个九宫格，主要用于处理 w s a d 按键移动，
   * 当同时按下w和s，这个值会是(-1,-1)，表示朝着左上移动
   */

  accelerateCommander: Vector = Vector.getZero();

  /**
   * 当前镜头缩放比例 >1放大 <1缩小
   * 会逐渐趋近于目标缩放比例
   */
  currentScale: number = 1;
  /** 目标镜头缩放比例 */
  targetScale: number = 1;

  /**
   * 震动特效导致的位置偏移
   * 也就是当有震动特效的时候，不是舞台在震动，而是摄像机在震动
   */
  readonly shakeLocation: Vector = Vector.getZero();

  private fitViewState: {
    previous: CameraView;
    fitted: CameraView;
    selection: ReadonlyMap<string, number>;
    overview?: CameraView;
  } | null = null;

  // pageup / pagedown 爆炸式移动

  private readonly shockMoveDiffLocationsQueue = new Queue<Vector>();
  /**
   * 触发一次翻页式移动
   *
   * 触发一次后，接下来的60帧里，摄像机都会移动一小段距离，朝向目的位置移动
   */
  pageMove(direction: Direction) {
    // 计算爆炸式移动的目标位置
    const targetLocation = this.location.clone();
    const rect = this.project.renderer.getCoverWorldRectangle();
    if (direction === Direction.Up) {
      targetLocation.y -= rect.height * 0.5;
    } else if (direction === Direction.Down) {
      targetLocation.y += rect.height * 0.5;
    } else if (direction === Direction.Left) {
      targetLocation.x -= rect.width * 0.5;
    } else if (direction === Direction.Right) {
      targetLocation.x += rect.width * 0.5;
    }
    // 生成接下来一些帧里的移动轨迹位置点。
    this.bombMove(targetLocation);
  }
  /**
   * 爆炸式移动
   * @param targetLocation 摄像机即将要移动到的世界坐标
   */
  bombMove(targetLocation: Vector, frameCount = 40) {
    // 先清空之前的队列
    this.shockMoveDiffLocationsQueue.clear();
    // 生成接下来一些帧里的移动轨迹位置点。
    const movePoints = [];
    for (let i = 0; i < frameCount; i++) {
      // 进度：0~1
      const rate = easeOutExpo(i / frameCount);
      const newPoint = this.location.add(targetLocation.subtract(this.location).multiply(rate));
      movePoints.push(newPoint);
    }
    // 根据位置轨迹点生成距离变化小向量段
    const diffLocations = [];
    for (let i = 1; i < movePoints.length; i++) {
      const diff = movePoints[i].subtract(movePoints[i - 1]);
      diffLocations.push(diff);
      // 将距离变化加入队列
      this.shockMoveDiffLocationsQueue.enqueue(diff);
    }
  }

  private tickIndex = -1;
  private hasResetOnOpen = false;

  tick() {
    // --- 初次打开文件的时候，重制视野
    this.tickIndex++; // 从0开始
    if (this.tickIndex >= 3 && !this.hasResetOnOpen) {
      this.reset(); // 刚打开文件的时候，重制视野。如果画布还没挂载（w=0或h=0），会在后续tick中重试
    }

    // 计算摩擦力 与速度方向相反,固定值,但速度为0摩擦力就不存在
    // 获得速度的大小和方向

    if (Number.isNaN(this.location.x) || Number.isNaN(this.location.y)) {
      // 实测只有把摩擦力和动力都拉满时才会瞬间触发NaN，当玩家正常数据状态下有意识地向远处飞时反而不会触发
      // 因此这个彩蛋可能是个bug。先暂时改成正常的提示语
      // this.project.effects.addEffect(new TextRiseEffect("派蒙：前面的区域以后再来探索吧？"));
      toast.error("数值溢出了，已自动重置视野" + `${this.location.x}, ${this.location.y}`);
      this.speed = Vector.getZero();
      this.reset();
      return;
    }

    this.currentScale = Camera.validScale(this.currentScale, 1);
    this.targetScale = Camera.validScale(this.targetScale, this.currentScale);
    // 冲击式移动
    if (!this.shockMoveDiffLocationsQueue.isEmpty()) {
      const diffLocation = this.shockMoveDiffLocationsQueue.dequeue();
      if (diffLocation !== undefined) {
        this.location = this.location.add(diffLocation);
      }
    }

    // 计算摩擦力
    let friction = Vector.getZero();

    if (!this.speed.isZero()) {
      const speedSize = this.speed.magnitude();

      friction = this.speed
        .normalize()
        .multiply(-1)
        .multiply(Settings.moveFriction * speedSize ** this.frictionExponent)
        .limitX(-300, 300)
        .limitY(-300, 300);
    }

    // 计算动力
    /** 摄像机 >1放大 <1缩小，为了让放大的时候移动速度慢，所以取倒数 */
    // 为了加强宏观快速移动，微观慢速移动的特性，动力计算公式再取了一个平方
    let power = this.accelerateCommander.multiply(Settings.moveAmplitude * (1 / this.currentScale) ** 2);
    power = power.limitX(-300, 300).limitY(-300, 300);

    // 速度 = 速度 + 加速度（动力+摩擦力）
    this.speed = this.speed.add(power).add(friction);
    this.location = this.location.add(this.speed);

    // 处理缩放
    // 缩放的过程中应该维持摄像机中心点和鼠标滚轮交互位置的相对视野坐标的 不变性

    /** 鼠标交互位置的view坐标系相对于画面左上角的坐标 */
    const diffViewVector = this.project.renderer.transformWorld2View(this.targetLocationByScale);
    const previousScale = this.currentScale;
    this.dealCameraScaleInTick();
    if (Settings.scaleCameraByMouseLocation && this.currentScale !== previousScale) {
      if (this.tickNumber > this.allowScaleFollowMouseLocationTicks) {
        this.setLocationByOtherLocation(this.targetLocationByScale, diffViewVector);
      }
    }
    if (this.isStartZoomIn) {
      this.targetScale *= 1.05;
    }
    if (this.isStartZoomOut) {
      this.targetScale *= 0.95;
    }
    this.targetScale = Camera.validScale(this.targetScale, this.currentScale);
    this.tickNumber++;
  }
  /**
   * 当前的帧编号
   */
  private tickNumber = 0;
  /**
   * 多少帧以后，才能继续跟随鼠标缩放
   */
  private allowScaleFollowMouseLocationTicks = 0;
  setAllowScaleFollowMouseLocationTicks(ticks: number) {
    this.allowScaleFollowMouseLocationTicks = ticks;
  }

  zoomInByKeyboardPress() {
    this.targetScale *= 1 + Settings.cameraKeyboardScaleRate;
    this.addScaleFollowMouseLocationTime(5);
  }

  zoomOutByKeyboardPress() {
    this.targetScale *= 1 - Settings.cameraKeyboardScaleRate;
    this.addScaleFollowMouseLocationTime(5);
  }

  public addScaleFollowMouseLocationTime(sec: number) {
    this.allowScaleFollowMouseLocationTicks = this.tickNumber + sec * 60;
  }

  public isStartZoomIn: boolean = false;
  public isStartZoomOut: boolean = false;

  /**
   * 修改摄像机位置，但是通过一种奇特的方式来修改
   * 将某个世界坐标位置对准当前的某个视野坐标位置，来修改摄像机位置
   * @param otherWorldLocation
   * @param viewLocation
   */
  private setLocationByOtherLocation(otherWorldLocation: Vector, viewLocation: Vector) {
    const otherLocationView = this.project.renderer.transformWorld2View(otherWorldLocation);
    const leftTopLocationWorld = this.project.renderer.transformView2World(otherLocationView.subtract(viewLocation));
    const rect = this.project.renderer.getCoverWorldRectangle();
    this.location = leftTopLocationWorld.add(rect.size.divide(2));
  }

  /**
   * 强制清除移动动力命令
   * 防止无限滚屏
   */
  clearMoveCommander() {
    this.accelerateCommander = Vector.getZero();
  }

  /**
   * 突然停止摄像机所有运动
   * 清除移动动力、速度、缩放操作
   */
  stopImmediately() {
    this.targetScale = this.currentScale;
    this.accelerateCommander = Vector.getZero();
    this.speed = Vector.getZero();
    this.isStartZoomIn = false;
    this.isStartZoomOut = false;
    this.shockMoveDiffLocationsQueue.clear();
  }

  applyGesture(previous: Vector, current: Vector, scaleFactor: number) {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
    const anchor = this.project.renderer.transformView2World(previous);
    this.stopImmediately();
    this.currentScale = Camera.validScale(this.currentScale * scaleFactor, this.currentScale);
    this.targetScale = this.currentScale;
    const center = new Vector(this.project.renderer.w / 2, this.project.renderer.h / 2);
    this.location = anchor.subtract(current.subtract(center).subtract(this.shakeLocation).divide(this.currentScale));
    this.targetLocationByScale = anchor;
  }

  panByViewDelta(delta: Vector) {
    this.stopImmediately();
    this.location = this.location.add(delta.divide(this.currentScale));
  }

  /**
   * 单纯缩放镜头
   * 让currentScale不断逼近targetScale
   * @returns 缩放前后变化的比值
   */
  private dealCameraScaleInTick() {
    // 直接手势已经设置了精确缩放值，不能再由逐帧舍入改变它。
    if (this.currentScale === this.targetScale) return 1;
    let newCurrentScale = this.currentScale;

    if (this.currentScale < this.targetScale) {
      newCurrentScale = Math.min(
        this.currentScale + (this.targetScale - this.currentScale) * Settings.scaleExponent,
        this.targetScale,
      );
    } else if (this.currentScale > this.targetScale) {
      newCurrentScale = Math.max(
        this.currentScale - (this.currentScale - this.targetScale) * Settings.scaleExponent,
        this.targetScale,
      );
    }
    const diff = newCurrentScale / this.currentScale;
    this.currentScale = newCurrentScale;

    return diff;
  }

  // 确保这个函数在软件打开的那一次调用
  constructor(private readonly project: Project) {}

  /**
   * 重置摄像机的缩放，让其画面刚好能容下舞台上所有内容的外接矩形
   * 还是不要有动画过度了，因为过度效果会带来一点卡顿（2024年10月25日）
   */
  reset() {
    // --防止初次打开文件就重制视野，导致NaN--
    if (this.project.renderer.w === 0 || this.project.renderer.h === 0) {
      return;
    }
    this.hasResetOnOpen = true;
    this.setView(this.getFullView());
    this.stopImmediately();
    SoundService.play.viewAdjustSoundFile();
  }

  resetBySelected() {
    const bounds = this.getSelectedBounds();
    if (!bounds) {
      this.reset();
      return;
    }
    this.resetByRectangle(bounds);
    SoundService.play.viewAdjustSoundFile();
  }

  resetByRectangle(viewRectangle: Rectangle) {
    this.setView(this.getRectangleView(viewRectangle));
  }

  private getSelectedBounds(selected = this.project.stageManager.getSelectedEntities()): Rectangle | undefined {
    if (selected.length) return Rectangle.getBoundingRectangle(selected.map((e) => e.collisionBox.getRectangle()));
  }

  private getFullView(margin = Vector.getZero()): CameraView {
    const { w, h } = this.project.renderer;
    const size = this.project.stageManager.getSize();
    return {
      location: this.project.stageManager.getCenter(),
      scale: Math.min(
        Settings.cameraResetViewPaddingRate,
        Math.max(1, w - 2 * margin.x) / size.x,
        Math.max(1, h - 2 * margin.y) / size.y,
      ),
    };
  }

  private getRectangleView(rectangle: Rectangle): CameraView {
    const { w, h } = this.project.renderer;
    const size = rectangle.size.multiply(Settings.cameraResetViewPaddingRate);
    return { location: rectangle.center, scale: Math.min(Settings.cameraResetMaxScale, w / size.x, h / size.y) };
  }

  private setView(view: CameraView) {
    this.location = view.location.clone();
    this.targetLocationByScale = view.location.clone();
    this.currentScale = this.targetScale = view.scale;
  }

  private isAtView(view: CameraView) {
    return this.currentScale === view.scale && this.targetScale === view.scale && this.location.equals(view.location);
  }

  toggleFitView() {
    const { w, h } = this.project.renderer;
    if (w <= 0 || h <= 0) return;

    const selected = this.project.stageManager.getSelectedEntities();
    const bounds = this.getSelectedBounds(selected);
    const getOverview = () => {
      const clientScale = this.project.canvas.viewToClientScale();
      const margin = new Vector(15 / Camera.validScale(clientScale.x, 1), 15 / Camera.validScale(clientScale.y, 1));
      return this.getFullView(margin);
    };
    const fitted = bounds ? this.getRectangleView(bounds) : getOverview();
    const lastFit = this.fitViewState;
    const sameFit =
      lastFit &&
      lastFit.fitted.scale === fitted.scale &&
      lastFit.fitted.location.equals(fitted.location) &&
      lastFit.selection.size === selected.length &&
      selected.every((entity) => lastFit.selection.get(entity.uuid) === entity.selectionOrder);
    if (sameFit && this.isAtView(fitted)) {
      if (bounds) {
        lastFit.overview = getOverview();
        this.setView(lastFit.overview);
        this.stopImmediately();
      } else {
        this.restoreCameraState();
      }
    } else {
      if (!sameFit || !lastFit.overview || !this.isAtView(lastFit.overview)) {
        this.fitViewState = {
          previous: { location: this.location.clone(), scale: this.currentScale },
          fitted,
          selection: new Map(selected.map((entity) => [entity.uuid, entity.selectionOrder])),
        };
      }
      this.hasResetOnOpen = true;
      this.setView(fitted);
      this.stopImmediately();
    }
    SoundService.play.viewAdjustSoundFile();
  }

  restoreCameraState() {
    if (!this.fitViewState) return;
    this.setView(this.fitViewState.previous);
    this.fitViewState = null;
    this.stopImmediately();
  }

  resetScale() {
    this.currentScale = 1;
    this.targetScale = 1;
  }

  resetLocationToZero() {
    this.bombMove(Vector.getZero());
  }

  isDefaultZoom(): boolean {
    return 0.1 < this.currentScale && this.currentScale < 4;
  }
}
