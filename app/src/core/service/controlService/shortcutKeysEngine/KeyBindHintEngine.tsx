import { Project, service } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { allKeyBinds } from "./shortcutKeysRegister";
import { parseEmacsKey } from "@/utils/emacs";
import { Vector } from "@graphif/data-structures";
import { getTextSize } from "@/utils/font";
import { KeyBindsUI } from "./KeyBindsUI";
import { formatKeyBindSequenceToString } from "@/utils/keyDisplay";
import i18next from "i18next";

// 根据 UI 缩放比例计算缩放后的字号
function scaledFontSize(base: number): number {
  return base * (Settings.uiScalePercent / 100);
}

function modifierCombo({ control, alt, shift, meta }: Omit<ReturnType<typeof parseEmacsKey>[number], "key">) {
  return [control && "C", alt && "A", shift && "S", meta && "M"].filter(Boolean).join("-");
}

const modifierKeys = ["control", "alt", "shift", "meta"];

type ToolbarShortcuts = { actionIds: ReadonlySet<string>; numberedKeys: ReadonlySet<string> };

/**
 * 快捷键提示引擎
 * 当按下修饰键时，显示匹配的快捷键提示
 */
@service("keyBindHintEngine")
export class KeyBindHintEngine {
  constructor(private readonly project: Project) {}

  // 每页显示的快捷键数量
  private readonly ITEMS_PER_PAGE = 10;

  // 当前页码
  private currentPage = 0;

  // 当前匹配的修饰键组合
  private currentModifierCombo: string = "";

  // 上一次按下的修饰键组合（用于检测翻页）
  private lastModifierCombo: string = "";

  private hintRequest = 0;
  private toolbarShortcuts?: ToolbarShortcuts;

  // 缓存的快捷键列表
  private cachedKeyBinds: Array<{
    displayKey: string;
    title: string;
  }> = [];

  registerToolbarShortcuts(shortcuts: ToolbarShortcuts) {
    this.toolbarShortcuts = shortcuts;
    this.currentModifierCombo = "";
    this.lastModifierCombo = "";
    return () => {
      this.toolbarShortcuts = undefined;
      this.currentModifierCombo = "";
      this.lastModifierCombo = "";
      this.hintRequest++;
    };
  }

  private getCurrentModifierCombo(): string {
    const keys = this.project.controller.pressingKeySet;
    if ([...keys].some((key) => !modifierKeys.includes(key))) return "";
    return modifierCombo({
      control: keys.has("control"),
      alt: keys.has("alt"),
      shift: keys.has("shift"),
      meta: keys.has("meta"),
    });
  }

  private async getMatchingKeyBinds(combo: string) {
    const registered = new Map(KeyBindsUI.getAllUIKeyBinds().map((binding) => [binding.id, binding]));
    const matches = await Promise.all(
      allKeyBinds.map(async ({ id, isGlobal }) => {
        const binding = registered.get(id);
        if (isGlobal || !binding?.isEnabled || this.toolbarShortcuts?.actionIds.has(id)) return;
        const key = binding.key.trim().replace(/\s+/g, " ");
        const strokes = parseEmacsKey(key);
        const first = strokes[0];
        if (modifierCombo(first) !== combo || (binding.isContinuous && strokes.length > 1)) return;
        if (
          strokes.some(
            (stroke) =>
              !stroke.key ||
              modifierKeys.includes(stroke.key) ||
              this.toolbarShortcuts?.numberedKeys.has(`${modifierCombo(stroke)}-${stroke.key}`),
          )
        ) {
          return;
        }
        if (!(await binding.when(this.project))) return;
        return { displayKey: formatKeyBindSequenceToString(key), title: this.getKeyBindTitle(id) };
      }),
    );
    return matches.filter((item) => item !== undefined);
  }

  /**
   * 获取快捷键标题
   * 从 i18n 翻译文件中读取
   */
  private getKeyBindTitle(id: string): string {
    // 使用 i18next 直接从翻译文件读取
    const translation = i18next.t(`${id}.title`, { ns: "keyBinds", defaultValue: "" });
    return translation || id;
  }

  /**
   * 更新提示状态
   * 在主渲染循环中调用
   */
  update() {
    const combo = this.getCurrentModifierCombo();
    if (!combo && this.project.controller.pressingKeySet.size > 0) {
      this.currentModifierCombo = "";
      this.currentPage = 0;
    }
    if (combo === this.lastModifierCombo) return;
    this.lastModifierCombo = combo;
    const request = ++this.hintRequest;
    if (!combo) return;

    this.currentPage = combo === this.currentModifierCombo ? this.currentPage + 1 : 0;
    this.currentModifierCombo = combo;
    this.cachedKeyBinds = [];
    void this.getMatchingKeyBinds(combo).then((matches) => {
      if (request !== this.hintRequest) return;
      this.cachedKeyBinds = matches;
      const pageCount = Math.ceil(matches.length / this.ITEMS_PER_PAGE);
      this.currentPage = pageCount ? this.currentPage % pageCount : 0;
    });
  }

  /**
   * 渲染快捷键提示
   */
  render() {
    if (!Settings.showKeyBindHint || !this.lastModifierCombo || this.cachedKeyBinds.length === 0) {
      return;
    }

    const totalPages = Math.ceil(this.cachedKeyBinds.length / this.ITEMS_PER_PAGE);
    const actualPage = Math.min(this.currentPage, totalPages - 1);

    // 获取当前页的快捷键
    const startIndex = actualPage * this.ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + this.ITEMS_PER_PAGE, this.cachedKeyBinds.length);
    const pageItems = this.cachedKeyBinds.slice(startIndex, endIndex);

    const scale = Settings.uiScalePercent / 100;

    // 计算起始位置（在左下角按键提示的上方）
    const margin = 10 * scale;
    const lineHeight = 28 * scale;
    const startY = this.project.renderer.h - 140 * scale - pageItems.length * lineHeight;

    // 渲染每个快捷键提示
    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const y = startY + i * lineHeight;

      // 使用复用的函数格式化修饰键组合
      let currentX = margin;

      const keyFontSize = scaledFontSize(16);
      // 渲染按键
      this.project.textRenderer.renderText(
        item.displayKey,
        new Vector(currentX, y),
        keyFontSize,
        this.project.stageStyleManager.currentStyle.effects.flash,
      );
      currentX += getTextSize(item.displayKey, keyFontSize).x;

      const titleFontSize = scaledFontSize(12);
      // 渲染标题
      this.project.textRenderer.renderText(
        item.title,
        new Vector(currentX + 15 * scale, y + 2 * scale),
        titleFontSize,
        this.project.stageStyleManager.currentStyle.DetailsDebugText,
      );
    }

    // 渲染页码指示器
    if (totalPages > 1) {
      const pageIndicator = `${actualPage + 1}/${totalPages}`;
      this.project.textRenderer.renderText(
        pageIndicator,
        new Vector(margin, startY - 20 * scale),
        scaledFontSize(12),
        this.project.stageStyleManager.currentStyle.DetailsDebugText,
      );
    }
  }
}
