import { Project, service } from "@/core/Project";
import { RectanglePushInEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectanglePushInEffect";
import { Settings } from "@/core/service/Settings";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { ConnectPoint } from "@/core/stage/stageObject/entity/ConnectPoint";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { DetailsManager } from "@/core/stage/stageObject/tools/entityDetailsManager";
import { Direction } from "@/types/directions";
import { Color, ProgressNumber, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

/**
 * 包含增加节点的方法
 * 有可能是用鼠标增加，涉及自动命名器
 * 也有可能是用键盘增加，涉及快捷键和自动寻找空地
 */
@service("nodeAdder")
export class NodeAdder {
  constructor(private readonly project: Project) {}

  /**
   * 通过点击位置增加节点
   * @param clickWorldLocation
   * 如果是直接创建，则需要记录位置，如果是通过已有位置创建，则还需要调整一次位置，此时不需要记录
   * @param shouldRecordHistory
   * @returns 创建节点的uuid
   */
  async addTextNodeByClick(
    clickWorldLocation: Vector,
    addToSections: Section[],
    selectCurrent = false,
    shouldRecordHistory = true,
    options?: {
      overrideFontScaleLevel?: number;
      getTopLeft?: (size: Vector) => Vector;
    },
  ): Promise<string> {
    const autoFillColor = this.getAutoColor();
    const autoDetailsTemplate = Settings.autoNamerDetailsTemplate;
    const autoDetails = autoDetailsTemplate
      ? DetailsManager.markdownToDetails(
          this.project.stageUtils.replaceAutoNameTemplate(
            autoDetailsTemplate,
            this.project.stageManager.getTextNodes()[0],
          ),
        )
      : [];
    const node = new TextNode(this.project, {
      text: await this.getAutoName(),
      details: autoDetails,
      collisionBox: new CollisionBox([new Rectangle(clickWorldLocation, Vector.getZero())]),
      color: autoFillColor,
      fontScaleLevel: options?.overrideFontScaleLevel ?? 0,
      borderStyle: Settings.textNodeInitBorderStyle,
    });
    // 根据摄像机缩放级别自动设置字体大小，使节点视觉大小保持恒定
    if (options?.overrideFontScaleLevel === undefined && Settings.newNodeScaleByCamera) {
      const autoLevel =
        Math.round(-2 * Math.log2(this.project.camera.currentScale)) + Settings.newNodeScaleByCameraOffset;
      if (autoLevel !== 0) {
        node.setFontScaleLevel(autoLevel);
      }
    }
    const size = node.rectangle.size;
    node.moveTo(options?.getTopLeft?.(size) ?? clickWorldLocation.subtract(size.divide(2)));
    this.project.stageManager.add(node);
    this.project.sectionInOutManager.goInSections([node], addToSections);

    if (node.parentSection) {
      node.parentSection.adjustLocationAndSize();
      this.project.effects.addEffect(
        new RectanglePushInEffect(
          node.rectangle.clone(),
          node.parentSection.rectangle.clone(),
          new ProgressNumber(0, 100),
        ),
      );
    }
    // 处理选中问题
    if (selectCurrent) {
      for (const otherNode of this.project.stageManager.getTextNodes()) {
        if (otherNode.isSelected) {
          otherNode.isSelected = false;
        }
      }
      node.isSelected = true;
    }
    if (shouldRecordHistory) {
      this.project.historyManager.recordStep();
    }
    return node.uuid;
  }

  /**
   * 在当前已经选中的某个节点的情况下，增加节点
   * 增加在某个选中的节点的上方，下方，左方，右方等位置
   * ——快深频
   * @param selectCurrent
   * @returns 返回的是创建节点的uuid，如果当前没有选中节点，则返回空字符串
   */
  async addTextNodeFromCurrentSelectedNode(direction: Direction, selectCurrent = false): Promise<string> {
    // 先检查当前是否有选中的唯一实体
    const selectedEntities = this.project.stageManager
      .getSelectedEntities()
      .filter((entity) => entity instanceof ConnectableEntity);
    if (selectedEntities.length !== 1) {
      // 未选中或选中多个
      return "";
    }
    /**
     * 当前选择的实体
     */
    const selectedEntity = selectedEntities[0];
    const source = selectedEntity.collisionBox.getRectangle();
    const sections = selectedEntity.parentSection ? [selectedEntity.parentSection] : [];
    const connections = this.project.stageManager
      .getAssociations()
      .filter(
        (edge): edge is ConnectableAssociation =>
          edge instanceof ConnectableAssociation && edge.associationList.includes(selectedEntity),
      );
    if (connections.length > 0) {
      return this.project.keyboardOnlyTreeEngine.generateChildNode("", true, false, {
        parent: selectedEntity,
        direction,
        selectCurrent,
        connections,
      });
    }
    return this.addTextNodeByClick(source.center, sections, selectCurrent, true, {
      overrideFontScaleLevel: selectedEntity instanceof TextNode ? selectedEntity.fontScaleLevel : 0,
      getTopLeft: (size) => this.findDirectionalNodeLocation(selectedEntity, direction, size, 64),
    });
  }

  public findDirectionalNodeLocation(
    anchor: ConnectableEntity,
    direction: Direction,
    size: Vector,
    gap: number,
    connections: readonly ConnectableAssociation[] = [],
  ): Vector {
    const source = anchor.collisionBox.getRectangle();
    const clearance = 16;
    const horizontal = direction === Direction.Left || direction === Direction.Right;
    const backward = direction === Direction.Left || direction === Direction.Up;
    const axis = horizontal ? "x" : "y";
    const location = source.location.clone();
    if (!horizontal) location.x = source.center.x - size.x / 2;
    const boundary = source.location[axis] + (backward ? 0 : source.size[axis]);
    location[axis] = backward ? boundary - gap - size[axis] : boundary + gap;
    const cross = horizontal ? "y" : "x";
    const sideBranches = this.getBranchesOnSide(anchor, direction, source, connections);
    const searchAxis = sideBranches.length > 0 ? cross : axis;
    const searchBackward = sideBranches.length === 0 && backward;
    // 同侧有分支时沿垂直于生长的方向排开，避免新节点落在现有连线上。
    for (const branch of sideBranches) {
      location[cross] = Math.max(location[cross], branch.location[cross] + branch.size[cross] + clearance * 2);
    }
    const ancestors = new Set<Section>();
    for (let section = anchor.parentSection; section; section = section.parentSection) ancestors.add(section);

    const obstacles = this.project.stageManager
      .getEntities()
      .filter(
        (entity) =>
          entity !== anchor &&
          !entity.isHiddenBySectionCollapse &&
          !(entity instanceof Section && ancestors.has(entity)) &&
          !(entity instanceof ImageNode && entity.isBackground),
      )
      .map((entity) => entity.collisionBox.getRectangle().expandFromCenter(clearance));
    const near = (box: Rectangle) =>
      searchBackward ? -(box.location[searchAxis] + box.size[searchAxis]) : box.location[searchAxis];
    obstacles.sort((a, b) => near(a) - near(b));
    const candidate = new Rectangle(location, size);
    for (const box of obstacles) {
      if (candidate.isCollideWith(box)) {
        location[searchAxis] = searchBackward
          ? box.location[searchAxis] - size[searchAxis]
          : box.location[searchAxis] + box.size[searchAxis];
      }
    }
    return location;
  }

  private getBranchesOnSide(
    anchor: ConnectableEntity,
    direction: Direction,
    source: Rectangle,
    connections: readonly ConnectableAssociation[],
  ): Rectangle[] {
    const branches: Rectangle[] = [];
    const center = source.center;
    for (const connection of connections) {
      const geometry = connection instanceof Edge ? connection.bodyLineGeometry : undefined;
      const rate = geometry ? (connection.source === anchor ? geometry.sourceRate : geometry.targetRate) : undefined;
      const normal = rate && Edge.getNormalVectorByRate(rate);
      for (const node of connection.associationList) {
        if (node === anchor || node.isHiddenBySectionCollapse) continue;
        const rect = node.collisionBox.getRectangle();
        const { x, y } = normal ?? rect.center.subtract(center);
        if (!x && !y) continue;
        const side =
          Math.abs(x) >= Math.abs(y)
            ? x < 0
              ? Direction.Left
              : Direction.Right
            : y < 0
              ? Direction.Up
              : Direction.Down;
        if (side === direction) branches.push(rect);
      }
    }
    return branches;
  }

  private async getAutoName(): Promise<string> {
    let template = Settings.autoNamerTemplate;
    template = this.project.stageUtils.replaceAutoNameTemplate(template, this.project.stageManager.getTextNodes()[0]);
    return template;
  }

  private getAutoColor(): Color {
    const isEnable = Settings.autoFillNodeColorEnable;
    if (isEnable) {
      const colorData = Settings.autoFillNodeColor;
      return new Color(...colorData);
    } else {
      return Color.Transparent;
    }
  }

  public addConnectPoint(clickWorldLocation: Vector, addToSections: Section[]): string {
    const connectPoint = new ConnectPoint(this.project, {
      collisionBox: new CollisionBox([
        new Rectangle(
          clickWorldLocation.subtract(Vector.same(ConnectPoint.CONNECT_POINT_SHRINK_RADIUS)),
          Vector.same(ConnectPoint.CONNECT_POINT_SHRINK_RADIUS * 2),
        ),
      ]),
    });
    this.project.stageManager.add(connectPoint);

    this.project.sectionInOutManager.goInSections([connectPoint], addToSections);

    if (connectPoint.parentSection) {
      connectPoint.parentSection.adjustLocationAndSize();
      this.project.effects.addEffect(
        new RectanglePushInEffect(
          connectPoint.collisionBox.getRectangle(),
          connectPoint.parentSection.rectangle.clone(),
          new ProgressNumber(0, 100),
        ),
      );
    }

    this.project.historyManager.recordStep();
    return connectPoint.uuid;
  }

  /**
   * 通过纯文本生成网状结构
   * 这个函数不稳定，可能会随时throw错误
   * @param text 网状结构的格式文本
   * @param diffLocation
   */
  public addNodeGraphByText(text: string, diffLocation: Vector = Vector.getZero()): void {
    this.project.stageImport.addNodeGraphByText(text, diffLocation);
  }

  /**
   * 通过带有缩进格式的文本来增加节点
   */
  public addNodeTreeByText(
    text: string,
    indention: number,
    diffLocation: Vector = Vector.getZero(),
    mindMap = false,
  ): void {
    this.project.stageImport.addNodeTreeByText(text, indention, diffLocation, mindMap);
  }

  /**
   * 根据 mermaid 文本生成框嵌套网状结构
   * 支持 graph TD 格式的 mermaid 文本
   * @param text Mermaid 格式文本
   * @param diffLocation 偏移位置
   */
  public addNodeMermaidByText(text: string, diffLocation: Vector = Vector.getZero()): void {
    this.project.stageImport.addNodeMermaidByText(text, diffLocation);
  }

  /**
   * 根据 Markdown 文本生成节点树结构
   * @param markdownText Markdown 格式文本
   * @param diffLocation 偏移位置
   * @param autoLayout 是否自动应用树形布局（默认为 true）
   */
  public addNodeByMarkdown(markdownText: string, diffLocation: Vector = Vector.getZero(), autoLayout = true) {
    this.project.stageImport.addNodeByMarkdown(markdownText, diffLocation, autoLayout);
  }
}
