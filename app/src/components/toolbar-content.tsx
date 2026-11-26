import type { Project } from "@/core/Project";
import { KeyBindsUI, type KeyBindIcon } from "@/core/service/controlService/shortcutKeysEngine/KeyBindsUI";
import { allKeyBinds } from "@/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister";
import { ColorManager } from "@/core/service/feedbackService/ColorManager";
import { Settings } from "@/core/service/Settings";
import { activeTabAtom, isClassroomModeAtom, store } from "@/state";
import { cn } from "@/utils/cn";
import { formatKeyBindSequenceToString } from "@/utils/keyDisplay";
import { isMac } from "@/utils/platform";
import { Color } from "@graphif/data-structures";
import { useAtomValue } from "jotai";
import {
  AlignHorizontalJustifyCenter,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowRightToLine,
  Blend,
  Brush,
  Command,
  createLucideIcon,
  Ellipsis,
  Hand,
  LayoutGrid,
  MousePointer,
  Package,
  Plus,
  Waypoints,
} from "lucide-react";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const mouseModes = [
  { mode: "selectAndMove", Icon: MousePointer, keyBindId: undefined },
  { mode: "drag", Icon: Hand, keyBindId: "toggleMouseDragMode" },
  { mode: "draw", Icon: Brush, keyBindId: "checkoutLeftMouseToDrawing" },
] as const;

const verticalSeparator = "|";
const spacingActions: readonly string[] = ["increaseSelectedNodeSpacing", "decreaseSelectedNodeSpacing"];
const alignRows = [
  [
    "alignTop",
    "alignBottom",
    "alignLeft",
    "alignRight",
    "alignCenterHorizontal",
    "alignCenterVertical",
    verticalSeparator,
    "arrangeSelectedVertical",
    "arrangeSelectedHorizontal",
  ],
] as const;
const layoutRows = [
  [
    "layoutToSquare",
    "layoutToSquareVertical",
    "mindMapLayout",
    "rectangleLayout",
    verticalSeparator,
    ...spacingActions,
  ],
] as const;

const modifierMenus = {
  Alt: { category: "align", modifier: "altKey", badge: isMac ? "⌥" : "Alt", rows: alignRows },
  Control: { category: "layout", modifier: "ctrlKey", badge: isMac ? "⌃" : "Ctrl", rows: layoutRows },
} as const;
const modifierMenuList = Object.values(modifierMenus).map((menu) => ({
  ...menu,
  actions: menu.rows[0].filter((id) => id !== verticalSeparator),
}));
const actionShortcuts = new Map(
  modifierMenuList.flatMap(({ badge, actions }) =>
    actions.map((id, index) => [id, { badge, digit: String(index + 1) }] as const),
  ),
);

const categories = [
  {
    id: "create",
    Icon: Plus,
    rows: [
      [
        "createTextNodeFromSelectedTop",
        "createTextNodeFromSelectedRight",
        "createTextNodeFromSelectedLeft",
        "createTextNodeFromSelectedDown",
      ],
    ],
  },
  {
    id: "align",
    Icon: AlignHorizontalJustifyCenter,
    rows: alignRows,
  },
  {
    id: "layout",
    Icon: LayoutGrid,
    rows: [...layoutRows, ["tidyTreeLayout", "radialTreeLayout", "layeredGraphLayout"]],
  },
  {
    id: "organize",
    Icon: Package,
    rows: [
      ["textNodeToSection", "unpackEntityFromSection"],
      ["folderSection", "toggleSectionLock"],
      ["createTwinTextNode"],
    ],
  },
  {
    id: "connect",
    Icon: Waypoints,
    rows: [
      [
        "connectAllSelectedEntities",
        "connectLeftToRight",
        "connectTopToBottom",
        "createUndirectedEdgeFromEntities",
        "createMTUEdgeConvex",
      ],
    ],
  },
] as const;

type Category = (typeof categories)[number]["id"] | "more";
const moreRows = [["undo", "redo", "deleteSelectedStageObjects"]] as const;
const directActionRows = [["jumpToSelectedEntities", "packEntityToSection"]] as const;
const toolbarShortcutHints = {
  actionIds: new Set<string>([
    ...mouseModes.flatMap(({ keyBindId }) => (keyBindId ? [keyBindId] : [])),
    ...categories.flatMap(({ rows }) => rows.flat()),
    ...moreRows.flat(),
    ...directActionRows.flat(),
  ]),
  numberedKeys: new Set(
    modifierMenuList.flatMap(({ modifier, actions }) =>
      actions.map((_, index) => `${modifier === "altKey" ? "A" : "C"}-${index + 1}`),
    ),
  ),
};

/*!
 * 这三个图标来自 lucide-static v1.78.0，当前 lucide-react 版本尚未提供。
 * @license ISC License
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const DiagramFlowVertical = createLucideIcon("DiagramFlowVertical", [
  ["path", { d: "M12 8.5a3.5 3.5 0 003.5 3.5 3.5 3.5 0 013.5 3.5v.5", key: "right-branch" }],
  ["path", { d: "M12 8v.5A3.5 3.5 0 018.5 12 3.5 3.5 0 005 15.5v.5", key: "left-branch" }],
  ["rect", { x: "16", y: "16", width: "6", height: "6", rx: "1", key: "right-node" }],
  ["rect", { x: "2", y: "16", width: "6", height: "6", rx: "1", key: "left-node" }],
  ["rect", { x: "9", y: "2", width: "6", height: "6", rx: "1", key: "root-node" }],
]);
const LayoutArrowDown = createLucideIcon("LayoutArrowDown", [
  ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1", key: "upper-node" }],
  ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1", key: "lower-node" }],
  ["path", { d: "M18 3v18", key: "arrow-line" }],
  ["path", { d: "m21 18-3 3-3-3", key: "arrow-tip" }],
]);
const LayoutArrowRight = createLucideIcon("LayoutArrowRight", [
  ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1", key: "left-node" }],
  ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1", key: "right-node" }],
  ["path", { d: "M3 18h18", key: "arrow-line" }],
  ["path", { d: "m18 21 3-3-3-3", key: "arrow-tip" }],
]);

const toolbarIcons: Record<string, KeyBindIcon> = {
  connectAllSelectedEntities: ArrowRightLeft,
  connectLeftToRight: ArrowRightToLine,
  connectTopToBottom: ArrowDownToLine,
  mindMapLayout: DiagramFlowVertical,
  arrangeSelectedVertical: LayoutArrowDown,
  arrangeSelectedHorizontal: LayoutArrowRight,
};

type ActionRows = readonly (readonly string[])[];
type OpenCategory = { id: Category; pinned: boolean } | null;
const CanvasOverlay = createContext<HTMLDivElement | null>(null);
const cornerShortcutClassName =
  "bg-popover text-popover-foreground pointer-events-none absolute right-px bottom-0.5 max-w-[calc(100%-2px)] truncate rounded-xs px-0.5 font-mono text-[9px]/[12px]";

function isCategoryVisible(id: Category, width: number) {
  return id === "more" || width >= 392 || (width >= 306 && (id === "create" || id === "layout"));
}

function stopCanvasKeys(event: ReactKeyboardEvent) {
  if (!event.altKey && !event.ctrlKey && !event.metaKey && [" ", "Enter", "Tab"].includes(event.key)) {
    event.stopPropagation();
  }
}

function runToolbarAction(id: string, project: Project) {
  project.controller.resetCountdownTimer();
  project.loop();
  void KeyBindsUI.execute(id, project, "toolbar");
}

export default function ToolbarContent({ project }: { project: Project }) {
  const isClassroomMode = useAtomValue(isClassroomModeAtom);
  const [viewerMode] = Settings.use("viewerMode");
  return isClassroomMode || viewerMode ? null : <CanvasTools project={project} />;
}

function CanvasTools({ project }: { project: Project }) {
  const { t } = useTranslation("canvasToolbar");
  const activeTab = useAtomValue(activeTabAtom);
  const [mouseMode] = Settings.use("mouseLeftMode");
  const modeBindings = KeyBindsUI.use((binding) => mouseModes.some(({ keyBindId }) => keyBindId === binding.id));
  const areaRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [openCategory, setOpenCategory] = useState<OpenCategory>(null);
  const [heldModifier, setHeldModifier] = useState<keyof typeof modifierMenus | null>(null);
  const [shortcutVersion, setShortcutVersion] = useState(0);
  const [layout, setLayout] = useState({ width: Infinity, tabBarHeight: 0 });

  useLayoutEffect(() => {
    const area = areaRef.current!;
    const tabBar = area
      .closest("[data-pg-tab-group-id]")
      ?.querySelector<HTMLElement>(":scope > [data-pg-canvas-tab-bar]");
    const measure = () => {
      const width = area.clientWidth;
      const tabBarHeight = tabBar?.offsetHeight ?? 0;
      setLayout((previous) =>
        previous.width === width && previous.tabBarHeight === tabBarHeight ? previous : { width, tabBarHeight },
      );
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(area);
    if (tabBar) observer.observe(tabBar);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => project.keyBindHintEngine?.registerToolbarShortcuts(toolbarShortcutHints), [project]);

  useEffect(() => {
    if (activeTab !== project) {
      setHeldModifier(null);
      return;
    }

    const openModifierMenu = (event: KeyboardEvent) => {
      if (
        (event.key !== "Alt" && event.key !== "Control") ||
        event.repeat ||
        event.isComposing ||
        (event.key === "Alt" ? event.ctrlKey : event.altKey) ||
        event.metaKey ||
        event.shiftKey ||
        !KeyBindsUI.shouldProcessKeyboardEvent()
      ) {
        return;
      }

      clearTimeout(closeTimer.current);
      setOpenCategory(null);
      setHeldModifier(event.key);
    };
    const closeModifierMenu = () => setHeldModifier(null);
    const releaseModifier = (event: KeyboardEvent) => {
      if (event.key === "Alt" || event.key === "Control") {
        setHeldModifier((held) => (held === event.key && !event[modifierMenus[held].modifier] ? null : held));
      }
    };
    const unregister = KeyBindsUI.registerInputInterceptor({
      onInput: (event) => {
        if (
          !(event instanceof KeyboardEvent) ||
          event.altKey === event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          store.get(activeTabAtom) !== project
        ) {
          return false;
        }

        const menu = modifierMenuList.find(({ modifier }) => event[modifier]);
        // macOS 的 Option＋数字会产生符号，按数字键的物理位置匹配。
        const digit = /^(?:Digit|Numpad)([1-8])$/.exec(event.code)?.[1] ?? event.key;
        if (!menu || !/^[1-8]$/.test(digit)) return false;
        const id = menu.actions[Number(digit) - 1];
        if (!id) return false;
        event.preventDefault();
        if (!event.repeat) {
          runToolbarAction(id, project);
          if (menu.category === "layout") setShortcutVersion((version) => version + 1);
        }
        return true;
      },
    });

    window.addEventListener("keydown", openModifierMenu);
    window.addEventListener("keyup", releaseModifier);
    window.addEventListener("blur", closeModifierMenu);
    return () => {
      unregister();
      window.removeEventListener("keydown", openModifierMenu);
      window.removeEventListener("keyup", releaseModifier);
      window.removeEventListener("blur", closeModifierMenu);
    };
  }, [activeTab, project]);

  useEffect(() => {
    setOpenCategory((current) => (current && isCategoryVisible(current.id, layout.width) ? current : null));
  }, [layout.width]);

  const visibleCategories = categories.filter(({ id }) => isCategoryVisible(id, layout.width));
  const preview = activeTab === project && heldModifier ? modifierMenus[heldModifier] : null;
  const previewCategory = preview && (isCategoryVisible(preview.category, layout.width) ? preview.category : "more");
  const overflowRows = useMemo(
    () => [
      ...categories
        .filter(({ id }) => !isCategoryVisible(id, layout.width))
        .flatMap<readonly string[]>(({ rows }) => rows),
      ...moreRows,
    ],
    [layout.width],
  );

  function close(id?: Category) {
    clearTimeout(closeTimer.current);
    setOpenCategory((current) => (!id || current?.id === id ? null : current));
  }

  function deferClose(id: Category) {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpenCategory((current) => (current?.id === id && !current.pinned ? null : current));
    }, 160);
  }

  function renderCategory(id: Category, Icon: KeyBindIcon, rows: ActionRows) {
    return (
      <ToolbarCategory
        key={id}
        label={t(id)}
        Icon={Icon}
        shortcut={
          id === "create" ? (isMac ? "⌘" : "Ctrl") : modifierMenuList.find((menu) => menu.category === id)?.badge
        }
        rows={preview?.category === id ? preview.rows : rows}
        shortcutVersion={shortcutVersion}
        project={project}
        boundary={areaRef.current}
        open={preview ? id === previewCategory : openCategory?.id === id}
        pinned={!preview && openCategory?.id === id && openCategory.pinned}
        onPreview={() => {
          if (preview) return;
          clearTimeout(closeTimer.current);
          setOpenCategory((current) => (current?.pinned ? current : { id, pinned: false }));
        }}
        onPin={() => {
          if (preview) return;
          clearTimeout(closeTimer.current);
          setOpenCategory({ id, pinned: true });
        }}
        onClose={() => {
          if (!preview) close(id);
        }}
        onEnterContent={() => clearTimeout(closeTimer.current)}
        onLeave={() => {
          if (!preview) deferClose(id);
        }}
      />
    );
  }

  return (
    <CanvasOverlay.Provider value={areaRef.current}>
      <div
        className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center gap-1.5"
        style={{ paddingTop: Math.max(layout.tabBarHeight + 8, 40) }}
        ref={areaRef}
        onKeyDown={stopCanvasKeys}
        onKeyUp={stopCanvasKeys}
      >
        <div
          role="toolbar"
          aria-label={t("title")}
          className="bg-popover text-popover-foreground border-border pointer-events-auto flex max-w-full items-center gap-0.5 rounded-lg border p-1 shadow-md"
        >
          {mouseModes.map(({ mode, Icon, keyBindId }) => {
            const label = t(mode);
            const binding = modeBindings.find(({ id }) => id === keyBindId);
            const shortcut =
              binding?.isEnabled && binding.key ? formatKeyBindSequenceToString(binding.key, "+", ", ") : "";
            const tooltip = (
              <>
                {label}
                {shortcut && (
                  <>
                    {" "}
                    <kbd className="opacity-80">{shortcut}</kbd>
                  </>
                )}
              </>
            );
            return (
              <CanvasTooltip key={mode} label={tooltip}>
                <Button
                  size="icon"
                  variant={mouseMode === mode ? "default" : "ghost"}
                  aria-label={label}
                  aria-pressed={mouseMode === mode}
                  className="relative size-8 min-w-0 shrink"
                  onClick={() => {
                    close();
                    Settings.mouseLeftMode = mouseMode === mode ? "selectAndMove" : mode;
                  }}
                >
                  <Icon data-icon="inline-start" />
                  {shortcut && (
                    <kbd aria-hidden="true" className={cornerShortcutClassName}>
                      {shortcut}
                    </kbd>
                  )}
                </Button>
              </CanvasTooltip>
            );
          })}
          <ToolbarActions
            rows={directActionRows}
            project={project}
            showShortcutBadge
            onRun={(id) => {
              close();
              runToolbarAction(id, project);
            }}
          />
          <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-5" />
          {visibleCategories.map(({ id, Icon, rows }) => renderCategory(id, Icon, rows))}
          {renderCategory("more", Ellipsis, preview && previewCategory === "more" ? preview.rows : overflowRows)}
        </div>
        {mouseMode === "draw" && <DrawingColorLine />}
      </div>
    </CanvasOverlay.Provider>
  );
}

function ToolbarCategory({
  label,
  Icon,
  shortcut,
  rows,
  shortcutVersion,
  project,
  boundary,
  open,
  pinned,
  onPreview,
  onPin,
  onClose,
  onEnterContent,
  onLeave,
}: {
  label: string;
  Icon: KeyBindIcon;
  shortcut?: string;
  rows: ActionRows;
  shortcutVersion: number;
  project: Project;
  boundary: HTMLElement | null;
  open: boolean;
  pinned: boolean;
  onPreview: () => void;
  onPin: () => void;
  onClose: () => void;
  onEnterContent: () => void;
  onLeave: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);

  function focusFirstAction() {
    const first =
      content.current?.querySelector<HTMLElement>("button:not(:disabled)") ??
      content.current?.querySelector<HTMLElement>("[tabindex='0']");
    (first ?? content.current)?.focus();
  }

  return (
    <Popover open={open} onOpenChange={onClose}>
      <CanvasTooltip label={label}>
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            size="icon"
            variant={open ? "secondary" : "ghost"}
            className="relative size-8 min-w-0 shrink"
            aria-label={label}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") onPreview();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") onLeave();
            }}
            onClick={(event) => {
              event.preventDefault();
              if (pinned) {
                onClose();
              } else {
                onPin();
                if (open) focusFirstAction();
              }
            }}
          >
            <Icon data-icon="inline-start" />
            {shortcut && (
              <kbd aria-hidden="true" className={cornerShortcutClassName}>
                {shortcut}
              </kbd>
            )}
          </Button>
        </PopoverTrigger>
      </CanvasTooltip>
      <PopoverContent
        ref={content}
        aria-label={label}
        side="bottom"
        sideOffset={8}
        collisionPadding={4}
        collisionBoundary={boundary ?? undefined}
        portalContainer={boundary}
        className="pointer-events-auto z-30 max-h-(--radix-popover-content-available-height) w-max max-w-(--radix-popover-content-available-width) overflow-auto p-1"
        onPointerEnter={onEnterContent}
        onPointerLeave={() => {
          if (!content.current?.contains(document.activeElement)) onLeave();
        }}
        onFocusCapture={onEnterContent}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (pinned) focusFirstAction();
        }}
        onEscapeKeyDown={() => {
          restoreFocus.current = !!content.current?.contains(document.activeElement);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (restoreFocus.current && document.activeElement === document.body) trigger.current?.focus();
          restoreFocus.current = false;
        }}
      >
        {open && (
          <ToolbarActions
            rows={rows}
            project={project}
            shortcutVersion={shortcutVersion}
            onRun={(id) => {
              restoreFocus.current = !!content.current?.contains(document.activeElement);
              runToolbarAction(id, project);
              if (!spacingActions.includes(id)) onClose();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ToolbarActions({
  rows,
  project,
  onRun,
  showShortcutBadge,
  shortcutVersion = 0,
}: {
  rows: ActionRows;
  project: Project;
  onRun: (id: string) => void;
  showShortcutBadge?: boolean;
  shortcutVersion?: number;
}) {
  const [bindings, setBindings] = useState(() => KeyBindsUI.getAllUIKeyBinds());
  const [selectionVersion, setSelectionVersion] = useState(0);

  useEffect(() => KeyBindsUI.onKeyBindListChange(setBindings), []);

  useEffect(() => {
    const ids = rows.flat();
    const summarize = () =>
      [
        project.stageManager.getSelectionSummary(),
        project.rectangleSelect.getRectangle() !== null,
        ids.includes("undo") && project.historyManager.canUndo,
        ids.includes("redo") && project.historyManager.canRedo,
        ids.includes("jumpToSelectedEntities") && project.controller.layerMoving.canJump(),
        ids.includes("jumpToSelectedEntities") && project.controller.layerMoving.isActive,
      ].join("|");
    let previous = summarize();
    const timer = setInterval(() => {
      const current = summarize();
      if (current !== previous) {
        previous = current;
        setSelectionVersion((version) => version + 1);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [project, rows]);

  return rows.map((row) => (
    <Fragment key={row[0]}>
      {row !== rows[0] && <Separator className="my-0.5" />}
      <div className={cn("flex gap-0.5", !row.includes(verticalSeparator) && "flex-wrap")}>
        {row.map((id, index) =>
          id === verticalSeparator ? (
            <Separator
              key={index}
              orientation="vertical"
              className="mx-0.5 self-center data-[orientation=vertical]:h-5"
            />
          ) : (
            <ToolbarAction
              key={id}
              id={id}
              binding={bindings.find((binding) => binding.id === id)}
              project={project}
              selectionVersion={selectionVersion + shortcutVersion}
              showShortcutBadge={showShortcutBadge}
              onRun={(id) => {
                onRun(id);
                if (spacingActions.includes(id) || id === "jumpToSelectedEntities") {
                  setSelectionVersion((version) => version + 1);
                }
              }}
            />
          ),
        )}
      </div>
    </Fragment>
  ));
}

function ToolbarAction({
  id,
  binding,
  project,
  selectionVersion,
  showShortcutBadge,
  onRun,
}: {
  id: string;
  binding: ReturnType<typeof KeyBindsUI.getUIKeyBind>;
  project: Project;
  selectionVersion: number;
  showShortcutBadge?: boolean;
  onRun: (id: string) => void;
}) {
  const { t } = useTranslation(["canvasToolbar", "keyBinds"]);
  const [asyncResult, setAsyncResult] = useState<{ version: number; binding: typeof binding; allowed: boolean }>();
  const available = useMemo(
    () => KeyBindsUI.canExecuteFromToolbar(id, project),
    [id, project, binding, binding?.isEnabled, selectionVersion],
  );
  useEffect(() => {
    if (typeof available === "boolean") return;
    let current = true;
    void available.then((allowed) => {
      if (current) setAsyncResult({ version: selectionVersion, binding, allowed });
    });
    return () => {
      current = false;
    };
  }, [available, selectionVersion, binding]);
  const disabled =
    typeof available === "boolean"
      ? !available
      : asyncResult?.version !== selectionVersion || asyncResult.binding !== binding || !asyncResult.allowed;
  const label = t(`keyBinds:${id}.title`);
  const tooltipLabel = t(`actions.${id}`, { defaultValue: label });
  const shortcut = binding?.key ? formatKeyBindSequenceToString(binding.key, "+", ", ") : "";
  const menuShortcut = actionShortcuts.get(id);
  const shortcutBadge = menuShortcut?.digit ?? (showShortcutBadge && binding?.isEnabled ? shortcut : "");
  const Icon = toolbarIcons[id] ?? binding?.icon ?? allKeyBinds.find((keyBind) => keyBind.id === id)?.icon ?? Command;
  const pressed = id === "jumpToSelectedEntities" ? project.controller.layerMoving.isActive : undefined;

  return (
    <CanvasTooltip
      label={
        <>
          {tooltipLabel}
          {shortcut && (
            <>
              {" "}
              <kbd className="opacity-80">{shortcut}</kbd>
            </>
          )}
          {menuShortcut && (
            <>
              {" "}
              <kbd className="opacity-80">
                {menuShortcut.badge}+{menuShortcut.digit}
              </kbd>
            </>
          )}
        </>
      }
    >
      <span
        className="focus-visible:ring-ring/50 inline-flex shrink-0 rounded-md focus-visible:ring-[3px]"
        role={disabled ? "group" : undefined}
        aria-label={disabled ? label : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? 0 : undefined}
      >
        <Button
          size="icon"
          variant={pressed ? "default" : "ghost"}
          className="relative size-8"
          disabled={disabled}
          aria-label={label}
          aria-pressed={pressed}
          onClick={() => onRun(id)}
        >
          <Icon data-icon="inline-start" />
          {shortcutBadge && (
            <kbd aria-hidden="true" className={cornerShortcutClassName}>
              {shortcutBadge}
            </kbd>
          )}
        </Button>
      </span>
    </CanvasTooltip>
  );
}

function CanvasTooltip({ children, label }: { children: React.ReactElement; label: React.ReactNode }) {
  const container = useContext(CanvasOverlay);
  return (
    <Tooltip delayDuration={800} disableHoverableContent>
      <TooltipTrigger>{children}</TooltipTrigger>
      <TooltipContent
        followCursor={false}
        side="top"
        sideOffset={6}
        portalContainer={container}
        className="z-40 border-neutral-700 bg-neutral-800 whitespace-nowrap text-neutral-100"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function DrawingColorLine() {
  const { t } = useTranslation("canvasToolbar");
  const [colors, setColors] = useState<Color[]>([]);
  const [strokeColor] = Settings.use("autoFillPenStrokeColor");
  const [useStrokeColor] = Settings.use("autoFillPenStrokeColorEnable");
  const selectedColor = useStrokeColor ? new Color(...strokeColor) : Color.Transparent;

  useEffect(() => {
    let active = true;
    const update = async () => {
      const next = await ColorManager.getUserEntityFillColors();
      if (active) setColors(next);
    };
    const unsubscribe = ColorManager.subscribe(update);
    void update();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <div
      role="group"
      aria-label={t("penColors")}
      className="bg-popover border-border pointer-events-auto flex max-w-full gap-0.5 overflow-x-auto rounded-md border p-1 shadow-sm"
    >
      {[Color.Transparent, ...colors.filter((color) => !color.equals(Color.Transparent))].map((color) => {
        const pressed = selectedColor.equals(color);
        const isDefault = color.equals(Color.Transparent);
        const label = isDefault ? t("defaultPenColor") : t("penColor", { color: color.toString() });
        return (
          <CanvasTooltip key={color.toString()} label={label}>
            <Button
              size="icon"
              variant="ghost"
              className={cn("size-6 border", pressed && "border-primary ring-primary/50 ring-1")}
              aria-label={label}
              aria-pressed={pressed}
              onClick={() => {
                Settings.autoFillPenStrokeColor = color.toArray();
                Settings.autoFillPenStrokeColorEnable = true;
              }}
            >
              {isDefault ? (
                <Blend data-icon="inline-start" />
              ) : (
                <span className="bg-background size-4 overflow-hidden rounded-sm border">
                  <span
                    className="block size-full"
                    style={{ backgroundColor: `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})` }}
                  />
                </span>
              )}
            </Button>
          </CanvasTooltip>
        );
      })}
    </div>
  );
}
