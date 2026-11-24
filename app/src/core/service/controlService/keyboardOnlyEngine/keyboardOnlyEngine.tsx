import { Project, service } from "@/core/Project";
import { RectangleLittleNoteEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectangleLittleNoteEffect";
import { Settings } from "@/core/service/Settings";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { getEnterKey } from "@/utils/keyboardFunctions";

/**
 * 纯键盘控制的相关引擎
 */
@service("keyboardOnlyEngine")
export class KeyboardOnlyEngine {
  private spaceEditPending = false;

  constructor(private readonly project: Project) {
    this.project.canvas.element.addEventListener("keydown", this.onKeyDown);
    this.project.canvas.element.addEventListener("keyup", this.onKeyUp);
    this.project.canvas.element.addEventListener("pointerdown", this.cancelSpaceEdit);
    this.project.canvas.element.addEventListener("blur", this.cancelSpaceEdit);
    window.addEventListener("blur", this.cancelSpaceEdit);
  }

  /**
   * 只有在某些面板打开的时候，这个引擎才会禁用，防止误触
   */
  private openning = true;
  setOpenning(value: boolean) {
    this.openning = value;
  }
  isOpenning() {
    return this.openning;
  }

  public dispose() {
    // 销毁服务
    this.project.canvas.element.removeEventListener("keydown", this.onKeyDown);
    this.project.canvas.element.removeEventListener("keyup", this.onKeyUp);
    this.project.canvas.element.removeEventListener("pointerdown", this.cancelSpaceEdit);
    this.project.canvas.element.removeEventListener("blur", this.cancelSpaceEdit);
    window.removeEventListener("blur", this.cancelSpaceEdit);
  }

  private startEditNode = (event: KeyboardEvent, selectedNode: TextNode) => {
    event.preventDefault(); // 这个prevent必须开启，否则会立刻在刚创建的输入框里输入一个换行符。
    this.addSuccessEffect();
    // 编辑节点
    setTimeout(() => {
      this.project.controllerUtils.editTextNode(selectedNode, Settings.textNodeSelectAllWhenStartEditByKeyboard);
    }, 1); // 上面的prevent似乎不生效了，但这里加个1毫秒就能解决了
  };

  private cancelSpaceEdit = () => {
    this.spaceEditPending = false;
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== " " || !this.spaceEditPending) return;
    this.cancelSpaceEdit();
    if (!this.openning || Settings.viewerMode) return;
    const selectedNode = this.project.stageManager.getTextNodes().find((node) => node.isSelected);
    if (selectedNode) this.startEditNode(event, selectedNode);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === " " && Settings.textNodeStartEditMode === "space") {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      if (!event.repeat) this.spaceEditPending = !this.project.controller.isMouseDown.some(Boolean);
    } else if (
      event.key === "Enter" &&
      !event.repeat &&
      this.openning &&
      !Settings.viewerMode &&
      Settings.textNodeStartEditMode === getEnterKey(event)
    ) {
      const selectedNode = this.project.stageManager.getTextNodes().find((node) => node.isSelected);
      if (selectedNode) this.startEditNode(event, selectedNode);
    } else if (event.key === "Escape") {
      this.project.keyboardOnlyGraphEngine.createCancel();
      this.project.stageManager.clearSelectAll();
    } else if (event.key === "F2") {
      const selectedNode = this.project.stageManager.getTextNodes().find((node) => node.isSelected);
      if (!selectedNode) return;
      // 编辑节点
      this.project.controllerUtils.editTextNode(selectedNode);
    } else {
      // SelectChangeEngine.listenKeyDown(event);
    }
  };

  private addSuccessEffect() {
    const textNodes = this.project.stageManager.getTextNodes().filter((textNode) => textNode.isSelected);
    for (const textNode of textNodes) {
      this.project.effects.addEffect(
        RectangleLittleNoteEffect.fromUtilsLittleNote(
          textNode,
          this.project.stageStyleManager.currentStyle.effects.successShadow,
        ),
      );
    }
  }
}
