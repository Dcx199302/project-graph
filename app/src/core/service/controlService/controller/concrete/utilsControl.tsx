import { Project, service } from "@/core/Project";
import { TabWorkspace } from "@/core/TabWorkspace";
import { Renderer } from "@/core/render/canvas2d/renderer";
import { Settings } from "@/core/service/Settings";
import { EntityCreateFlashEffect } from "@/core/service/feedbackService/effectEngine/concrete/EntityCreateFlashEffect";
import { RectangleLittleNoteEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectangleLittleNoteEffect";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import type { StageObject } from "@/core/stage/stageObject/abstract/StageObject";
import type { Edge } from "@/core/stage/stageObject/association/Edge";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { MediaNode } from "@/core/stage/stageObject/entity/MediaNode";
import { ReferenceBlockNode } from "@/core/stage/stageObject/entity/ReferenceBlockNode";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { SvgNode } from "@/core/stage/stageObject/entity/SvgNode";
import { TextNode, type TextNodeResizeAnchor } from "@/core/stage/stageObject/entity/TextNode";
import { Direction } from "@/types/directions";
import { resolveFontFamily } from "@/utils/font";
import type { Color } from "@graphif/data-structures";
import { colorInvert, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { toast } from "sonner";
import {
  autoChangeTextNodeToLatexNode,
  autoChangeTextNodeToReferenceBlock,
  AutoCompleteManager,
  LatexPreviewManager,
} from "./utilsControlTools";

/**
 * 这里是专门存放代码相同的地方
 *    因为有可能多个控制器公用同一个代码，
 */
@service("controllerUtils")
export class ControllerUtils {
  private readonly autoComplete: AutoCompleteManager;
  private edgeEditor?: {
    uuid: string;
    element: HTMLTextAreaElement;
    resize: () => void;
  };

  constructor(private readonly project: Project) {
    this.autoComplete = new AutoCompleteManager(project);
  }

  private viewRectangleToClient(rectangle: Rectangle) {
    const scale = this.project.canvas.viewToClientScale();
    return new Rectangle(
      this.project.canvas.viewToClient(rectangle.location),
      new Vector(rectangle.width * scale.x, rectangle.height * scale.y),
    );
  }

  /**
   * 编辑节点
   * @param clickedNode
   */
  editTextNode(
    clickedNode: TextNode,
    selectAll = true,
    autoFormatTree = Settings.textNodeAutoFormatTreeWhenInput,
    resizeAnchor?: TextNodeResizeAnchor,
  ) {
    this.project.controller.isCameraLocked = true;
    // 停止摄像机漂移
    this.project.camera.stopImmediately();
    // 停止实体移动漂移
    this.project.entityMoveManager.stopImmediately();
    const rectWorld = clickedNode.collisionBox.getRectangle();
    const rectView = this.project.renderer.transformWorld2View(rectWorld);
    const rectClient = this.viewRectangleToClient(rectView);
    const clientScale = this.project.canvas.viewToClientScale();
    // 编辑节点
    const textBeforeEdit = clickedNode.text;
    // 进入编辑状态时，取消所有其他节点的选中，只保留当前节点选中
    this.project.stageManager.clearSelectAll();
    clickedNode.isSelected = true;
    clickedNode.isEditing = true;
    // 添加进入编辑状态的闪烁特效（只在默认缩放级别时显示）
    if (this.project.camera.isDefaultZoom()) {
      this.project.effects.addEffect(
        RectangleLittleNoteEffect.fromUtilsLittleNote(
          clickedNode,
          this.project.stageStyleManager.currentStyle.effects.successShadow,
        ),
      );
    }
    const syncTextareaPositionWithNode = (ele: HTMLTextAreaElement) => {
      const currentRectView = this.project.renderer.transformWorld2View(clickedNode.collisionBox.getRectangle());
      const currentRectClient = this.viewRectangleToClient(currentRectView);
      if (resizeAnchor === "right") {
        ele.style.right = `${(window.innerWidth - currentRectClient.right).toFixed(2)}px`;
      } else {
        ele.style.left = `${currentRectClient.left.toFixed(2)}px`;
      }
      if (resizeAnchor === "bottomCenter") {
        ele.style.bottom = `${(window.innerHeight - currentRectClient.bottom).toFixed(2)}px`;
      } else {
        ele.style.top = `${currentRectClient.top.toFixed(2)}px`;
      }
      ele.style.minWidth = `${currentRectClient.width.toFixed(2)}px`;
      ele.style.minHeight = `${currentRectClient.height.toFixed(2)}px`;
      ele.style.height = `${currentRectClient.height.toFixed(2)}px`;
      if (clickedNode.sizeAdjust === "manual") {
        ele.style.width = `${currentRectClient.width.toFixed(2)}px`;
      }
    };
    const relayoutTreeWhileEditing = () => {
      if (this.project.autoLayout.getPreservedLayout(clickedNode)) return;
      const rootNodes = this.project.graphMethods.getRoots(clickedNode, true);
      if (rootNodes.length !== 1) {
        return;
      }
      const rootNode = rootNodes[0];
      if (this.project.autoLayout.hasPreservedLayoutInTree(rootNode)) return;
      const validationResult = this.project.graphMethods.validateTreeStructure(rootNode, true);
      if (!validationResult.isValid) {
        return;
      }
      this.project.autoLayoutFastTree.autoLayoutFastTreeMode(rootNode);
      rootNode.isSelected = false;
      clickedNode.isSelected = true;
    };
    let lastAutoCompleteTabId: string;
    // 实时 LaTeX 预览管理器（输入 $...$ 时在节点上方显示）
    const latexPreview = new LatexPreviewManager();

    this.project.inputElement
      .textarea(
        clickedNode.text,
        (text, ele) => {
          const currentRequestId = latexPreview.nextRequestId();
          if (lastAutoCompleteTabId) {
            void TabWorkspace.close(lastAutoCompleteTabId);
          }
          // 自动补全逻辑
          this.autoComplete.handle(text, clickedNode, ele, (value) => {
            lastAutoCompleteTabId = value;
          });
          // onChange
          clickedNode.rename(text, resizeAnchor);
          if (autoFormatTree) {
            relayoutTreeWhileEditing();
          }
          syncTextareaPositionWithNode(ele);
          // 宽度由 inputElement.tsx 的 adjustSize（镜像 div 测量）负责，此处不再重复设置
          // 自动调整它的外层框的大小
          const fatherSections = this.project.sectionMethods.getFatherSectionsList(clickedNode);
          for (const section of fatherSections) {
            section.adjustLocationAndSize();
          }

          // 实时 LaTeX 预览：检测光标附近的 $...$ 片段
          const cursor =
            ele.selectionStart === null
              ? text.length
              : ele.selectionStart > 0 && text[ele.selectionStart - 1] === "$"
                ? ele.selectionStart - 1
                : ele.selectionStart;
          const latexContent = LatexPreviewManager.getInlineLatexAtCursor(text, cursor);
          if (latexContent !== null) {
            if (!latexPreview.isDismissed() && currentRequestId === latexPreview.currentRequestId()) {
              const currentRectView = this.project.renderer.transformWorld2View(
                clickedNode.collisionBox.getRectangle(),
              );
              latexPreview.update(latexContent, this.viewRectangleToClient(currentRectView));
            }
          } else {
            latexPreview.remove();
          }
        },
        {
          position: "fixed",
          resize: "none",
          boxSizing: "border-box",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          left: resizeAnchor === "right" ? undefined : `${rectClient.left.toFixed(2)}px`,
          right: resizeAnchor === "right" ? `${(window.innerWidth - rectClient.right).toFixed(2)}px` : undefined,
          top: resizeAnchor === "bottomCenter" ? undefined : `${rectClient.top.toFixed(2)}px`,
          bottom:
            resizeAnchor === "bottomCenter" ? `${(window.innerHeight - rectClient.bottom).toFixed(2)}px` : undefined,
          // ====
          // auto 模式：初始给节点宽度+8作为起始值，adjustSize 会用镜像 div 立即修正
          // manual 模式：宽度固定为节点当前宽度，不扩展
          width: `${(clickedNode.sizeAdjust === "manual" ? rectClient.width : rectClient.width + 8 * clientScale.x).toFixed(2)}px`,
          minWidth: `${rectClient.width.toFixed(2)}px`,
          minHeight: `${rectClient.height.toFixed(2)}px`,
          height: `${rectClient.height.toFixed(2)}px`,
          padding: `${clickedNode.getPadding() * this.project.camera.currentScale * clientScale.x}px`,
          fontSize: `${clickedNode.getFontSize() * this.project.camera.currentScale * clientScale.x}px`,
          backgroundColor: "transparent",
          color: (clickedNode.color.a === 1
            ? colorInvert(clickedNode.color)
            : colorInvert(this.project.stageStyleManager.currentStyle.Background)
          ).toHexStringWithoutAlpha(),
          // 编辑描边由 Canvas 绘制，避免 WebView 的 CSS 圆角与节点轮廓不一致。
          outline: "none",
          border: "none",
          borderRadius: `${clickedNode.getBorderRadius() * clientScale.x}px`,
        },
        selectAll,
        Settings.textNodeExitEditModeOnWheel,
        { fixedWidth: clickedNode.sizeAdjust === "manual" ? rectClient.width : undefined },
      )
      .then(async () => {
        void TabWorkspace.close(lastAutoCompleteTabId);
        // 移除 LaTeX 实时预览 div
        latexPreview.dismiss();
        clickedNode!.isEditing = false;
        this.project.controller.isCameraLocked = false;
        // 完整公式在退出编辑时转换，编辑期间保留源码。
        const convertedToLatex = autoChangeTextNodeToLatexNode(this.project, clickedNode);
        if (convertedToLatex || clickedNode.text !== textBeforeEdit) {
          this.project.historyManager.recordStep();
        }

        if (!convertedToLatex) await autoChangeTextNodeToReferenceBlock(this.project, clickedNode);
      });
  }

  positionEdgeEditor(uuid: string, center: Vector, size: number, color: Color): boolean {
    const editor = this.edgeEditor;
    if (editor?.uuid !== uuid) return false;

    if (Settings.textIntegerLocationAndSizeRender) {
      center = center.toInteger();
      size = Math.round(size);
    }
    const location = this.project.canvas.viewToClient(center);
    const { x: clientScale } = this.project.canvas.viewToClientScale();
    const fontSize = `${Math.max(1, size * clientScale).toFixed(2)}px`;
    const { style } = editor.element;
    style.left = `${location.x.toFixed(2)}px`;
    style.top = `${location.y.toFixed(2)}px`;
    style.color = color.toString();
    if (style.fontSize !== fontSize) {
      style.fontSize = fontSize;
      editor.resize();
    }
    style.opacity = "1";
    return true;
  }

  async editEdgeText(edge: Edge | MultiTargetUndirectedEdge, selectAll = true): Promise<void> {
    if (this.edgeEditor) return;
    const originalText = edge.text;
    this.project.controller.isCameraLocked = true;
    this.project.controller.resetCountdownTimer();
    this.project.camera.stopImmediately();
    this.project.loop();
    try {
      await this.project.inputElement.textarea(
        edge.text,
        (text) => {
          edge.rename(text);
        },
        {
          position: "fixed",
          resize: "none",
          boxSizing: "border-box",
          overflow: "hidden",
          whiteSpace: "pre",
          textAlign: "center",
          lineHeight: "1.2",
          transform: "translate(-50%, -50%)",
          minWidth: "1em",
          padding: "0 0.15em",
          cursor: "text",
          userSelect: "text",
          fontFamily: resolveFontFamily(),
          opacity: "0",
          backgroundColor: this.project.stageStyleManager.currentStyle.Background.toString(),
          border: "none",
          outline: "none",
        },
        selectAll,
        false,
        {
          edgeLabel: (element, resize) => {
            this.edgeEditor = { uuid: edge.uuid, element, resize };
            const center = this.project.renderer.transformWorld2View(edge.textRectangle.center);
            const fontSize =
              "textFontSize" in edge && typeof edge.textFontSize === "number" ? edge.textFontSize : Renderer.FONT_SIZE;
            const color =
              edge.color.a === 0 ? this.project.stageStyleManager.currentStyle.StageObjectBorder : edge.color;
            this.positionEdgeEditor(edge.uuid, center, fontSize * this.project.camera.currentScale, color);
          },
        },
      );
      if (edge.text !== originalText) {
        this.project.historyManager.recordStep();
      }
    } finally {
      this.edgeEditor = undefined;
      this.project.controller.isCameraLocked = false;
      this.project.controller.resetCountdownTimer();
    }
  }

  /**
   * 通过快捷键的方式来打开Entity的详细信息编辑
   */
  editNodeDetailsByKeyboard() {
    const nodes = this.project.stageManager.getEntities().filter((node) => node.isSelected);
    if (nodes.length === 0) {
      toast.error("请先选择一个节点，才能编辑详细信息");
      return;
    }
    this.editNodeDetails(nodes[0]);
  }

  async editNodeDetails(clickedNode: Entity) {
    // this.project.controller.isCameraLocked = true;
    // 编辑节点详细信息的视野移动锁定解除，——用户：快深频
    const { default: NodeDetailsWindow } = await import("@/sub/NodeDetailsWindow");
    if (!this.project.stage.includes(clickedNode)) return;
    NodeDetailsWindow.open(clickedNode.details, (value) => {
      clickedNode.details = value;
      // 向孪生兄弟同步 details
      this.project.syncAssociationManager.syncFrom(clickedNode, "details");
    });
  }

  async addTextNodeByLocation(location: Vector, selectCurrent: boolean = false, autoEdit: boolean = false) {
    const sections = this.project.sectionMethods.getSectionsByInnerLocation(location);
    // 新建节点
    const uuid = await this.project.nodeAdder.addTextNodeByClick(location, sections, selectCurrent);
    if (autoEdit) {
      // 自动进入编辑模式
      this.textNodeInEditModeByUUID(uuid);
    }
    return uuid;
  }
  createConnectPoint(location: Vector) {
    const sections = this.project.sectionMethods.getSectionsByInnerLocation(location);
    this.project.nodeAdder.addConnectPoint(location, sections);
  }

  addTextNodeFromCurrentSelectedNode(direction: Direction, selectCurrent = false) {
    const resizeAnchors: Partial<Record<Direction, TextNodeResizeAnchor>> = {
      [Direction.Left]: "right",
      [Direction.Up]: "bottomCenter",
      [Direction.Down]: "topCenter",
    };
    this.project.nodeAdder.addTextNodeFromCurrentSelectedNode(direction, selectCurrent).then((uuid) => {
      setTimeout(() => {
        this.textNodeInEditModeByUUID(uuid, resizeAnchors[direction], false);
      });
    });
  }

  textNodeInEditModeByUUID(uuid: string, resizeAnchor?: TextNodeResizeAnchor, autoFormatTree?: boolean) {
    const createNode = this.project.stageManager.getTextNodeByUUID(uuid);
    if (createNode === null) {
      // 说明 创建了立刻删掉了
      return;
    }
    // 整特效
    this.project.effects.addEffect(EntityCreateFlashEffect.fromCreateEntity(createNode));
    this.editTextNode(createNode, true, autoFormatTree, resizeAnchor);
  }

  /**
   * 检测鼠标是否点击到了某个stage对象上
   * @param clickedLocation
   */
  getClickedStageObject(clickedLocation: Vector) {
    let clickedStageObject: StageObject | null = this.project.stageManager.findEntityByLocation(clickedLocation);
    // 补充：在大标题覆盖形态下，空白区域也应该稳定命中对应的 Section。
    if (clickedStageObject === null) {
      const clickedSections = this.project.sectionMethods.getSectionsByInnerLocation(clickedLocation);
      clickedStageObject =
        clickedSections.find((section) => this.project.sectionMethods.isSectionBigTitleActive(section)) ?? null;
    }
    if (clickedStageObject === null) {
      for (const association of this.project.stageManager.getAssociations()) {
        if (!association.isPhysical) {
          continue; // 非物理对象（如 SyncAssociation）不参与点击检测
        }
        if (association instanceof LineEdge) {
          if (association.target.isHiddenBySectionCollapse && association.source.isHiddenBySectionCollapse) {
            continue;
          }
        }
        if (association.collisionBox.isContainsPoint(clickedLocation)) {
          clickedStageObject = association;
          break;
        }
      }
    }
    return clickedStageObject;
  }

  /**
   * 鼠标是否点击在了调整大小的小框上
   * @param clickedLocation
   */
  isClickedResizeRect(clickedLocation: Vector): boolean {
    const selectedEntities = this.project.stageManager.getSelectedStageObjects();

    for (const selectedEntity of selectedEntities) {
      // 检查是否是支持缩放的实体类型
      if (
        selectedEntity instanceof TextNode ||
        selectedEntity instanceof ImageNode ||
        selectedEntity instanceof SvgNode ||
        selectedEntity instanceof MediaNode ||
        selectedEntity instanceof ReferenceBlockNode
      ) {
        // 对TextNode进行特殊处理，只在手动模式下允许缩放
        if (selectedEntity instanceof TextNode && selectedEntity.sizeAdjust === "auto") {
          continue;
        }

        const resizeRect = selectedEntity.getResizeHandleRect();
        if (resizeRect.isPointIn(clickedLocation)) {
          // 点中了扩大缩小的东西
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 将选中的内容标准化
   * 如果选中了外层的section，也选中了内层的物体，则取消选中内部的物体
   */
  public selectedEntityNormalizing() {
    const selectedEntities = this.project.stageManager.getSelectedEntities();
    const shallowerSections = this.project.sectionMethods.shallowerSection(
      selectedEntities.filter((entity) => entity instanceof Section),
    );
    const shallowerEntities = this.project.sectionMethods.shallowerNotSectionEntities(selectedEntities);
    for (const entity of selectedEntities) {
      if (entity instanceof Section) {
        if (!shallowerSections.includes(entity)) {
          entity.isSelected = false;
        }
      } else {
        if (!shallowerEntities.includes(entity)) {
          entity.isSelected = false;
        }
      }
    }
  }

  editSectionTitle(section: Section) {
    if (this.project.sectionMethods.isObjectBeLockedBySection(section)) {
      toast.error("无法编辑已锁定的section");
      return;
    }
    this.project.controller.isCameraLocked = true;
    this.project.camera.stopImmediately();
    section.isEditingTitle = true;
    const inputViewLocation = this.project.renderer
      .transformWorld2View(section.rectangle.location.subtract(new Vector(0, section.text === "" ? 50 : 0)))
      .add(Vector.same(Renderer.NODE_PADDING).multiply(this.project.camera.currentScale));
    const clientScale = this.project.canvas.viewToClientScale();
    const titleWidth = () =>
      `${Math.max(1, section.rectangle.size.x - Renderer.NODE_PADDING * 2) * this.project.camera.currentScale * clientScale.x}px`;
    this.project.inputElement
      .input(
        this.project.canvas.viewToClient(inputViewLocation),
        section.text,
        (text, element) => {
          section.rename(text);
          element.style.width = titleWidth();
        },
        {
          position: "fixed",
          resize: "none",
          boxSizing: "border-box",
          width: titleWidth(),
          fontSize: `${Renderer.FONT_SIZE * this.project.camera.currentScale * clientScale.x}px`,
          borderRadius: `${Renderer.NODE_ROUNDED_RADIUS * this.project.camera.currentScale * clientScale.x}px`,
          backgroundColor: "transparent",
          color: this.project.stageStyleManager.currentStyle.StageObjectBorder.toString(),
          outline: `solid ${2 * this.project.camera.currentScale * clientScale.x}px ${this.project.stageStyleManager.currentStyle.effects.successShadow.toNewAlpha(0.25).toString()}`,
          marginTop: `${-8 * this.project.camera.currentScale * clientScale.y}px`,
        },
      )
      .then(() => {
        section.isEditingTitle = false;
        this.project.controller.isCameraLocked = false;
        this.project.historyManager.recordStep();
      });
  }
}
