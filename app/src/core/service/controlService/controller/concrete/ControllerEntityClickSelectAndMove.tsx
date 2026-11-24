import { ControllerClass } from "@/core/service/controlService/controller/ControllerClass";
import { ShakeDetector } from "@/core/service/controlService/controller/utils/ShakeDetector";
import { ConnectNodeSmartTools } from "@/core/service/dataManageService/connectNodeSmartTools";
import { RectangleNoteEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectangleNoteEffect";
import { RectangleRenderEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectangleRenderEffect";
import { Settings } from "@/core/service/Settings";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { CursorNameEnum } from "@/types/cursors";
import { isMac } from "@/utils/platform";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

/**
 * 拖拽节点使其移动的控制器
 *
 */
export class ControllerEntityClickSelectAndMoveClass extends ControllerClass {
  protected get allowViewerModeInteraction(): boolean {
    return true;
  }

  private dragButton: number | null = null;
  private dragTarget: Entity | null = null;
  private hasMovedEntity = false;
  private mouseDownViewLocation = Vector.getZero();
  private lastDragViewLocation = Vector.getZero();
  private shakeDetector = new ShakeDetector();
  /** 按住 Shift 拖拽时锁定的移动轴，null 表示尚未确定 */
  private shiftAxisLock: "x" | "y" | null = null;
  /** 按住 Shift 拖拽时，相对于按下时世界坐标的累计位移，用于确定锁定轴 */
  private shiftAccumulatedDelta = Vector.getZero();

  public tryStartDrag(event: MouseEvent): boolean {
    const middle = event.button === 1 && !event.ctrlKey;
    const hand = event.button === 0 && Settings.mouseLeftMode === "drag";
    if ((!middle && !hand) || Settings.viewerMode || this.project.controller.isCameraLocked) return false;
    if (hand && Settings.enableSpaceKeyMouseLeftDrag && this.project.controller.pressingKeySet.has(" ")) return false;

    const point = new Vector(event.clientX, event.clientY);
    const worldPoint = this.project.renderer.transformView2World(point);
    const clicked = this.project.controllerUtils.getClickedStageObject(worldPoint);
    if (!(clicked instanceof Entity)) return false;
    const target = this.project.sectionMethods.getOutermostLockedAncestorSection(clicked) ?? clicked;
    this.beginDrag(event, target);
    this.project.camera.stopImmediately();
    return true;
  }

  private beginDrag(event: MouseEvent, target: Entity | null = null) {
    this.dragButton = event.button;
    this.dragTarget = target;
    this.hasMovedEntity = false;
    this.mouseDownViewLocation = new Vector(event.clientX, event.clientY);
    this.lastDragViewLocation = this.mouseDownViewLocation;
    this.shakeDetector.reset();
    this.shiftAxisLock = null;
    this.shiftAccumulatedDelta = Vector.getZero();
  }

  public mousedown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    if (Settings.mouseLeftMode !== "selectAndMove") {
      return;
    }
    if (this.project.controller.camera.isPreGrabbingWhenSpace) {
      return;
    }
    const pressWorldLocation = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));

    // 检查是否点击了缩放控制点，如果是，就不要触发移动事件
    if (this.project.controllerUtils.isClickedResizeRect(pressWorldLocation)) {
      return;
    }

    const clickedStageObject = this.project.controllerUtils.getClickedStageObject(pressWorldLocation);
    const directDrag = (event.pointerType === "touch" || event.pointerType === "pen") && !Settings.viewerMode;

    // 检查点击的物体是否在锁定的 section 内
    if (clickedStageObject && clickedStageObject instanceof Entity) {
      if (clickedStageObject instanceof Section) {
        const outermostLockedAncestor =
          this.project.sectionMethods.getOutermostLockedAncestorSection(clickedStageObject);
        if (outermostLockedAncestor) {
          this.project.stageManager.getStageObjects().forEach((obj) => {
            obj.isSelected = false;
          });
          outermostLockedAncestor.isSelected = true;
          if (directDrag) this.beginDrag(event);
          return;
        }
      } else {
        // 对于其他实体：如果有锁定的祖先section，转而选中并拖动最外层锁定section
        if (this.project.sectionMethods.isObjectBeLockedBySection(clickedStageObject)) {
          const outermostLockedSection =
            this.project.sectionMethods.getOutermostLockedAncestorSection(clickedStageObject);
          if (outermostLockedSection) {
            this.project.stageManager.getStageObjects().forEach((obj) => {
              obj.isSelected = false;
            });
            outermostLockedSection.isSelected = true;
            if (directDrag) this.beginDrag(event);
          }
          return;
        }
      }
    }

    // 防止跳跃式移动的时候改变选中内容
    if (this.project.controller.pressingKeySet.has("alt")) {
      return;
    }

    // 单击选中
    if (clickedStageObject !== null) {
      if (directDrag && clickedStageObject instanceof Entity) this.beginDrag(event);

      if (
        this.project.controller.pressingKeySet.has("shift") &&
        (isMac
          ? this.project.controller.pressingKeySet.has("meta")
          : this.project.controller.pressingKeySet.has("control"))
      ) {
        // ctrl + shift 同时按下
        clickedStageObject.isSelected = !clickedStageObject.isSelected;
      } else if (this.project.controller.pressingKeySet.has("shift")) {
        // shift 按下，只选中节点
        clickedStageObject.isSelected = true;
        // 没有实体被选中则return
        if (this.project.stageManager.getSelectedEntities().length === 0) return;
        const rectangles = this.project.stageManager
          .getSelectedEntities()
          .map((entity) => entity.collisionBox.getRectangle());
        const boundingRectangle = Rectangle.getBoundingRectangle(rectangles);
        this.project.effects.addEffect(RectangleRenderEffect.fromShiftClickSelect(boundingRectangle));
        this.project.effects.addEffect(RectangleNoteEffect.fromShiftClickSelect(this.project, boundingRectangle));
        for (const entity of this.project.stageManager.getStageObjects()) {
          if (entity.collisionBox.isIntersectsWithRectangle(boundingRectangle)) {
            entity.isSelected = true;
          }
        }
      } else if (
        isMac
          ? this.project.controller.pressingKeySet.has("meta")
          : this.project.controller.pressingKeySet.has("control")
      ) {
        // ctrl 按下，只选中节点，不能模仿windows文件管理器设置成反选，否则会和直接移动节点子树冲突
        clickedStageObject.isSelected = true;
      } else {
        // 直接点击
        if (!clickedStageObject.isSelected) {
          // 清空所有其他节点的选中状态
          this.project.stageManager.getStageObjects().forEach((stageObject) => {
            if (stageObject === clickedStageObject) {
              return;
            }
            stageObject.isSelected = false;
          });
        }

        // 选中点击节点的状态
        clickedStageObject.isSelected = true;
      }
    } else {
      // 未点击到节点
    }
  };

  public mousemove: (event: MouseEvent) => void = (event: MouseEvent) => {
    if (this.dragButton === null) return;
    if (Settings.viewerMode) {
      this.finishDrag(false);
      return;
    }
    if (
      this.project.controller.rectangleSelect.isUsing ||
      this.project.controller.cutting.isUsing ||
      (!this.dragTarget && this.project.controller.pressingKeySet.has("alt"))
    ) {
      return;
    }
    const viewLocation = new Vector(event.clientX, event.clientY);
    if (this.dragTarget && !this.hasMovedEntity) {
      if (viewLocation.distance(this.mouseDownViewLocation) <= 5) return;
      if (!this.dragTarget.isSelected) {
        this.project.stageManager.clearSelectAll();
        this.dragTarget.isSelected = true;
      }
    }
    const worldLocation = this.project.renderer.transformView2World(viewLocation);
    let diffLocation = worldLocation.subtract(this.project.renderer.transformView2World(this.lastDragViewLocation));
    this.lastDragViewLocation = viewLocation;

    {
      // 按住 Shift 键：锁定水平或垂直方向移动
      const isShiftPressed = this.project.controller.pressingKeySet.has("shift");
      if (isShiftPressed) {
        // 累计位移用于确定锁定轴（避免刚按下时微小抖动误判方向）
        this.shiftAccumulatedDelta = this.shiftAccumulatedDelta.add(diffLocation);
        if (this.shiftAxisLock === null) {
          const absX = Math.abs(this.shiftAccumulatedDelta.x);
          const absY = Math.abs(this.shiftAccumulatedDelta.y);
          // 累计位移超过 3 像素时才确定轴方向
          if (absX > 3 || absY > 3) {
            this.shiftAxisLock = absX >= absY ? "x" : "y";
          }
        }
        // 锁定后，将垂直于锁定轴的分量清零
        if (this.shiftAxisLock === "x") {
          diffLocation = new Vector(diffLocation.x, 0);
        } else if (this.shiftAxisLock === "y") {
          diffLocation = new Vector(0, diffLocation.y);
        }
      } else {
        // Shift 松开时重置锁定状态
        this.shiftAxisLock = null;
        this.shiftAccumulatedDelta = Vector.getZero();
      }
    }

    if (!diffLocation.equals(Vector.getZero()) && this.project.stageManager.isHaveEntitySelected()) {
      // 移动节点
      if (this.dragTarget && !this.hasMovedEntity) this.project.controller.setCursorName(CursorNameEnum.Grabbing);
      this.hasMovedEntity = true;
      // 暂不监听alt键。因为windows下切换窗口时，alt键释放监听不到
      const isControlPressed = isMac
        ? this.project.controller.pressingKeySet.has("meta")
        : this.project.controller.pressingKeySet.has("control");

      const withChildren = Settings.reverseTreeMoveMode ? !isControlPressed : isControlPressed;
      this.project.entityMoveManager.dragSelectedEntities(diffLocation, withChildren);

      // 预瞄反馈
      if (Settings.enableDragAutoAlign) {
        this.project.autoAlign.preAlignAllSelected();
      }

      // 检测摇晃动作 - 只在开启设置且选中单个节点时检测
      if (Settings.enableDragNodeShakeDetachFromEdge && !this.shakeDetector.hasTriggered()) {
        const selectedEntities = this.project.stageManager.getSelectedEntities();
        if (selectedEntities.length === 1) {
          // 使用窗口坐标（屏幕像素）进行摇晃检测，与世界坐标缩放无关
          const viewLocation = new Vector(event.clientX, event.clientY);
          const isShaking = this.shakeDetector.addSample(viewLocation, Date.now());
          if (isShaking) {
            // 检测到摇晃，触发节点脱离（不向上平移）
            ConnectNodeSmartTools.removeNodeFromTree(this.project, false);
          }
        }
      }
    }
  };

  public mouseup: (event: MouseEvent) => void = (event: MouseEvent) => {
    if (event.button !== this.dragButton) return;
    if ((this.dragTarget || this.hasMovedEntity) && !Settings.viewerMode) this.mousemove(event);
    this.finishDrag(!Settings.viewerMode);
  };

  private finishDrag(snap: boolean) {
    if (this.dragButton === null) return;
    const moved = this.hasMovedEntity;
    const showCursor = this.dragTarget !== null && moved;
    this.dragButton = null;
    this.dragTarget = null;
    this.hasMovedEntity = false;
    this.shakeDetector.reset();
    this.shiftAxisLock = null;
    this.shiftAccumulatedDelta = Vector.getZero();

    if (showCursor) {
      this.project.controller.setCursorName(
        this.project.controller.camera.isPreGrabbingWhenSpace ? CursorNameEnum.Grab : CursorNameEnum.Default,
      );
    }
    if (!moved) return;
    this.project.entityMoveManager.finishDragging(() => {
      if (snap && Settings.enableDragAutoAlign) this.project.autoAlign.alignAllSelected();
      if (snap && Settings.enableDragAlignToGrid) this.project.autoAlign.alignAllSelectedToGrid();
    });
    this.project.historyManager.recordStep();
  }

  public mouseMoveOutWindowForcedShutdown(_outsideLocation: Vector): void {
    super.mouseMoveOutWindowForcedShutdown(_outsideLocation);
    this.finishDrag(false);
  }
}
