import { Project } from "@/core/Project";
import { activeResourceTabAtom, activeTabAtom, store } from "@/state";
import {
  formatEmacsKey,
  matchEmacsKeyPress,
  parseSingleEmacsKey,
  transEmacsKeyWinToMac,
  transformedKeys,
} from "@/utils/emacs";
import { isMac } from "@/utils/platform";
import { createStore } from "@/utils/store";
import { Queue } from "@graphif/data-structures";
import { proxy } from "comlink";
import type { LucideProps } from "lucide-react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { useEffect, useState } from "react";
import { allKeyBinds, type KeyBindPress, type KeyBindWhen } from "./shortcutKeysRegister";

export type KeyBindIcon = ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>;

export interface UIKeyBind {
  id: string;
  key: string;
  isEnabled: boolean;
  onPress: KeyBindPress;
  when: KeyBindWhen;
  toolbarWhen?: KeyBindWhen;
  icon?: KeyBindIcon;
  // 是否是持续型快捷键
  isContinuous?: boolean;
  isToggle?: boolean;
  isRepeatable?: boolean;
  onRelease?: (project?: Project) => void;
}

export interface KeyBindInputInterceptor {
  onInput: (
    event: KeyboardEvent | MouseEvent | WheelEvent,
    sequence: readonly (KeyboardEvent | MouseEvent | WheelEvent)[],
  ) => boolean | Promise<boolean>;
  onKeyUp?: (event: KeyboardEvent) => void | Promise<void>;
  onMouseUp?: (event: MouseEvent) => void | Promise<void>;
}
/**
 * UI级别的快捷键管理
 */
export namespace KeyBindsUI {
  const userEventQueue = new Queue<KeyboardEvent | MouseEvent | WheelEvent>();

  function enqueue(event: MouseEvent | KeyboardEvent | WheelEvent) {
    // 队列里面最多20个（因为秘籍键长度最大20）
    while (userEventQueue.length >= 20) {
      userEventQueue.dequeue();
    }
    userEventQueue.enqueue(event);
  }

  // 工具栏热更新后可能拿到新的模块实例，快捷键仍由已经挂载的应用管理。
  const registry: {
    bindings: UIKeyBind[];
    ids: Set<string>;
    listListeners: Set<(keyBinds: UIKeyBind[]) => void>;
    bindingListeners: Map<string, Set<(keyBind: UIKeyBind) => void>>;
  } = import.meta.hot?.data?.keyBindRegistry ?? {
    bindings: [],
    ids: new Set(),
    listListeners: new Set(),
    bindingListeners: new Map(),
  };
  if (import.meta.hot?.data) import.meta.hot.data.keyBindRegistry = registry;
  const inputInterceptors = new Set<KeyBindInputInterceptor>();

  export function registerInputInterceptor(interceptor: KeyBindInputInterceptor): () => void {
    inputInterceptors.add(interceptor);
    return () => inputInterceptors.delete(interceptor);
  }

  async function interceptInput(event: KeyboardEvent | MouseEvent | WheelEvent): Promise<boolean> {
    for (const interceptor of inputInterceptors) {
      if (await interceptor.onInput(event, userEventQueue.arrayList)) {
        userEventQueue.clear();
        return true;
      }
    }
    return false;
  }

  function getActiveProject(): Project | undefined {
    const tab = store.get(activeResourceTabAtom);
    return tab instanceof Project ? tab : undefined;
  }

  function getFocusedProject(): Project | undefined {
    const tab = store.get(activeTabAtom);
    return tab instanceof Project ? tab : undefined;
  }

  /**
   * 获取所有已注册的UI快捷键
   */
  export function getAllUIKeyBinds(): UIKeyBind[] {
    return registry.bindings;
  }

  /**
   * 获取指定ID的快捷键
   */
  export function getUIKeyBind(id: string): UIKeyBind | undefined {
    return registry.bindings.find((kb) => kb.id === id);
  }

  export async function canExecute(id: string, project = getActiveProject()): Promise<boolean> {
    return bindingAvailability(getUIKeyBind(id), project);
  }

  function bindingAvailability(keyBind?: UIKeyBind, project?: Project, source?: "toolbar"): boolean | Promise<boolean> {
    if (!keyBind?.isEnabled) return false;
    const when = source === "toolbar" ? (keyBind.toolbarWhen ?? keyBind.when) : keyBind.when;
    return when(project);
  }

  export function canExecuteFromToolbar(id: string, project: Project): boolean | Promise<boolean> {
    return bindingAvailability(getUIKeyBind(id), project, "toolbar");
  }

  export async function execute(id: string, project = getActiveProject(), source?: "toolbar"): Promise<boolean> {
    const keyBind = getUIKeyBind(id);
    if (!keyBind) return false;
    const allowed = bindingAvailability(keyBind, project, source);
    if (!(source === "toolbar" && typeof allowed === "boolean" ? allowed : await allowed)) return false;
    const actionProject = keyBind.id.startsWith("ext:") && project ? proxy(project) : project;
    await (source ? keyBind.onPress(actionProject, source) : keyBind.onPress(actionProject));
    if (keyBind.onRelease) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await keyBind.onRelease(actionProject);
    }
    return true;
  }

  /**
   * 监听快捷键列表的整体变化（新增或注销快捷键时触发）
   * @param callback 回调函数，接收最新的全量快捷键列表
   * @returns 取消监听的函数
   */
  export function onKeyBindListChange(callback: (keyBinds: UIKeyBind[]) => void): () => void {
    registry.listListeners.add(callback);
    // 立即以当前状态回调一次，确保订阅者拿到最新值（BehaviorSubject 语义）
    callback([...registry.bindings]);
    return () => {
      registry.listListeners.delete(callback);
    };
  }

  /**
   * 通知快捷键列表整体变化
   */
  function notifyKeyBindListChange() {
    registry.listListeners.forEach((callback) => {
      callback([...registry.bindings]);
    });
  }

  /**
   * React Hook：订阅快捷键列表，返回经过 filter 过滤后的响应式列表。
   * 列表发生变化时组件自动重渲染。
   *
   * @param filter 可选过滤函数，默认返回全部快捷键
   * @example
   * // 获取所有快捷键
   * const binds = KeyBindsUI.use();
   * // 只获取某个插件的快捷键
   * const binds = KeyBindsUI.use((kb) => kb.id.startsWith("ext:my-ext:"));
   */
  export function use(filter?: (kb: UIKeyBind) => boolean): UIKeyBind[] {
    // 初始值同步计算，避免首次渲染闪烁
    const [binds, setBinds] = useState<UIKeyBind[]>(() => {
      const all = getAllUIKeyBinds();
      return filter ? all.filter(filter) : all;
    });

    useEffect(() => {
      // 订阅后续变化；onKeyBindListChange 也会立即回调一次同步当前值，
      // 确保 useEffect 执行时若列表已更新也能正确反映
      return onKeyBindListChange((all) => {
        setBinds(filter ? all.filter(filter) : all);
      });
    }, []); // filter 是调用方传入的内联箭头函数，不应放入依赖数组

    return binds;
  }

  /**
   * 监听指定快捷键的变化
   * @param id 快捷键ID
   * @param callback 回调函数
   * @returns 取消监听的函数
   */
  export function onKeyBindChange(id: string, callback: (keyBind: UIKeyBind) => void): () => void {
    if (!registry.bindingListeners.has(id)) {
      registry.bindingListeners.set(id, new Set());
    }
    registry.bindingListeners.get(id)!.add(callback);

    // 立即返回当前值
    const currentKeyBind = getUIKeyBind(id);
    if (currentKeyBind) {
      callback(currentKeyBind);
    }

    return () => {
      registry.bindingListeners.get(id)?.delete(callback);
    };
  }

  /**
   * 通知快捷键变化
   */
  function notifyKeyBindChange(id: string, keyBind: UIKeyBind) {
    const listeners = registry.bindingListeners.get(id);
    if (listeners) {
      listeners.forEach((callback) => {
        callback(keyBind);
      });
    }
  }

  /**
   * 注册所有非全局快捷键
   * 会先检查是否已经存下来了，如果已经存下来了，先注册存下来的
   * 否则再注册默认快捷键
   */
  export async function registerAllUIKeyBinds() {
    const store = await createStore("keybinds2.json");
    const toolbarPackShortcutMigrated = (await store.get<boolean>("toolbarPackShortcutMigrated")) === true;
    const toolbarGroupShortcutMigrated = (await store.get<boolean>("toolbarGroupShortcutMigrated")) === true;
    const toolbarDragShortcutMigrated = (await store.get<boolean>("toolbarDragShortcutMigrated")) === true;
    const directionalShortcutsMigrated = (await store.get<boolean>("directionalShortcutsMigrated")) === true;
    const reverseEdgesShortcutMigrated = (await store.get<boolean>("reverseEdgesShortcutMigrated")) === true;
    const previousToolbarKeys = new Map([
      ["packEntityToSection", isMac ? "M-g" : "C-g"],
      ["createTwinTextNode", "y"],
    ]);
    const previousDirectionalKeys = new Map([
      ["createTextNodeFromSelectedTop", "A-arrowup"],
      ["createTextNodeFromSelectedDown", "A-arrowdown"],
      ["createTextNodeFromSelectedLeft", "A-arrowleft"],
      ["createTextNodeFromSelectedRight", "A-arrowright"],
      ["moveUpSelectedEntities", "C-arrowup"],
      ["moveDownSelectedEntities", "C-arrowdown"],
      ["moveLeftSelectedEntities", "C-arrowleft"],
      ["moveRightSelectedEntities", "C-arrowright"],
    ]);
    const platformKey = (key: string) => (isMac ? transEmacsKeyWinToMac(key) : key);
    for (const keybind of allKeyBinds.filter((keybindItem) => !keybindItem.isGlobal)) {
      const savedData = await store.get<any>(keybind.id);
      let key: string;
      let isEnabled: boolean;

      if (!savedData) {
        // 没有保存过，走默认设置
        key = platformKey(keybind.defaultKey);
        isEnabled = keybind.defaultEnabled !== false;
        await store.set(keybind.id, { key, isEnabled });
      } else if (typeof savedData === "string") {
        // 兼容旧数据结构
        key = savedData;
        isEnabled = keybind.defaultEnabled !== false;
        await store.set(keybind.id, { key, isEnabled });
      } else {
        // 已经保存过完整配置
        key = savedData.key;
        isEnabled = savedData.isEnabled !== false;
      }
      if (isMac && keybind.id === "redo" && !(await store.get<boolean>("macRedoShortcutMigrated"))) {
        if (key === "M-y") {
          key = transEmacsKeyWinToMac(keybind.defaultKey);
          await store.set(keybind.id, { key, isEnabled });
        }
        await store.set("macRedoShortcutMigrated", true);
      }
      const previousToolbarKey = previousToolbarKeys.get(keybind.id);
      const previousDirectionalKey = previousDirectionalKeys.get(keybind.id);
      if (!directionalShortcutsMigrated && previousDirectionalKey && key === platformKey(previousDirectionalKey)) {
        key = platformKey(keybind.defaultKey);
        await store.set(keybind.id, { key, isEnabled });
      }
      if (
        (keybind.id === "checkoutLeftMouseToDrawing" && key === "b b b") ||
        (keybind.id === "generateNodeTreeWithBroadMode" && key === "\\") ||
        (!reverseEdgesShortcutMigrated && keybind.id === "reverseEdges" && key === platformKey("C-t")) ||
        (!toolbarPackShortcutMigrated && previousToolbarKey !== undefined && key === previousToolbarKey) ||
        (!toolbarGroupShortcutMigrated && keybind.id === "packEntityToSection" && key === "h") ||
        (!toolbarDragShortcutMigrated && keybind.id === "toggleMouseDragMode" && key === "")
      ) {
        key = keybind.defaultKey;
        await store.set(keybind.id, { key, isEnabled });
      }

      KeyBindsUI.registerOneUIKeyBind(
        keybind.id,
        key,
        isEnabled,
        keybind.onPress,
        keybind.onRelease,
        keybind.isContinuous,
        keybind.when,
        keybind.icon,
        keybind.toolbarWhen,
        keybind.isToggle,
        keybind.isRepeatable,
      );
    }
    if (!toolbarPackShortcutMigrated) await store.set("toolbarPackShortcutMigrated", true);
    if (!toolbarGroupShortcutMigrated) await store.set("toolbarGroupShortcutMigrated", true);
    if (!toolbarDragShortcutMigrated) await store.set("toolbarDragShortcutMigrated", true);
    if (!directionalShortcutsMigrated) await store.set("directionalShortcutsMigrated", true);
    if (!reverseEdgesShortcutMigrated) await store.set("reverseEdgesShortcutMigrated", true);
    await store.save();
  }
  /**
   * 注册一个非全局快捷键
   * 只会在软件启动的时候注册一次
   * 其他情况下，只会在修改快捷键的时候进行重新修改值
   */
  export function registerOneUIKeyBind(
    id: string,
    key: string,
    isEnabled: boolean = true,
    onPress: KeyBindPress = () => {},
    onRelease?: (project?: Project) => void,
    isContinuous?: boolean,
    when: KeyBindWhen = () => true,
    icon?: KeyBindIcon,
    toolbarWhen?: KeyBindWhen,
    isToggle?: boolean,
    isRepeatable?: boolean,
  ) {
    const keyBind: UIKeyBind = {
      id,
      key,
      isEnabled,
      onPress,
      onRelease,
      when,
      isContinuous,
      icon,
      toolbarWhen,
      isToggle,
      isRepeatable,
    };
    if (registry.ids.has(id)) {
      // 检查是否已经是同 ID 的快捷键，如果是，则更新它（用于扩展重新认领逻辑）
      const index = registry.bindings.findIndex((kb) => kb.id === id);
      if (index !== -1) {
        registry.bindings[index] = keyBind;
        notifyKeyBindChange(id, keyBind);
        notifyKeyBindListChange();
        return;
      }
      console.warn(`Keybind ${id} 已经注册过了`);
      return;
    }
    registry.ids.add(id);
    registry.bindings.push(keyBind);

    // 通知监听器有新的快捷键注册
    notifyKeyBindChange(id, keyBind);
    // 通知快捷键列表整体变化
    notifyKeyBindListChange();
  }

  /**
   * 注销一个快捷键
   */
  export function unregisterOneUIKeyBind(id: string) {
    if (!registry.ids.delete(id)) return;
    registry.bindings = registry.bindings.filter((kb) => kb.id !== id);
    // 通知快捷键列表整体变化（UI 需要移除对应项）
    notifyKeyBindListChange();
  }

  /**
   * 用于修改快捷键
   * @param id
   * @param key
   */
  export async function changeOneUIKeyBind(id: string, key: string) {
    let updatedKeyBind: UIKeyBind | undefined;
    registry.bindings = registry.bindings.map((it) => {
      if (it.id === id) {
        updatedKeyBind = { ...it, key };
        return updatedKeyBind;
      }
      return it;
    });

    // 通知监听器快捷键已更改
    if (updatedKeyBind) {
      notifyKeyBindChange(id, updatedKeyBind);
      notifyKeyBindListChange();
    }

    const store = await createStore("keybinds2.json");
    const currentConfig = await store.get<any>(id);
    await store.set(id, {
      key,
      isEnabled: currentConfig?.isEnabled !== false,
    });
    await store.save();
  }

  /**
   * 用于切换快捷键启用状态
   * @param id
   * @returns 新的启用状态
   */
  export async function toggleEnabled(id: string): Promise<boolean> {
    let newEnabledState = true;

    registry.bindings = registry.bindings.map((it) => {
      if (it.id === id) {
        newEnabledState = !it.isEnabled;
        return { ...it, isEnabled: newEnabledState };
      }
      return it;
    });
    notifyKeyBindListChange();

    const store = await createStore("keybinds2.json");
    const currentConfig = await store.get<any>(id);
    const keybind = allKeyBinds.find((kb) => kb.id === id);
    await store.set(id, {
      key: currentConfig?.key || keybind?.defaultKey || "",
      isEnabled: newEnabledState,
    });
    await store.save();

    return newEnabledState;
  }

  /**
   * 重置所有快捷键为默认值（包括快捷键值和启用状态）
   */
  export async function resetAllKeyBinds() {
    const store = await createStore("keybinds2.json");
    // 清空存储
    await store.clear();
    // 清空已注册的快捷键
    registry.ids.clear();
    registry.bindings = [];
    // 重新注册所有快捷键
    await registerAllUIKeyBinds();
  }

  /**
   * 仅重置所有快捷键的启用状态为默认值
   */
  export async function resetAllKeyBindsEnabledState() {
    const store = await createStore("keybinds2.json");

    // 遍历所有非全局快捷键
    for (const keybind of allKeyBinds.filter((keybindItem) => !keybindItem.isGlobal)) {
      const currentConfig = await store.get<any>(keybind.id);

      // 如果存在当前配置，只重置isEnabled字段，保留key字段
      if (currentConfig) {
        await store.set(keybind.id, {
          key: currentConfig.key,
          isEnabled: keybind.defaultEnabled !== false,
        });
      } else {
        // 如果不存在配置，使用默认值创建
        let defaultValue = keybind.defaultKey;
        if (isMac) {
          defaultValue = transEmacsKeyWinToMac(defaultValue);
        }
        await store.set(keybind.id, {
          key: defaultValue,
          isEnabled: keybind.defaultEnabled !== false,
        });
      }
    }

    await store.save();

    // 更新内存中的快捷键配置
    for (const uiKeyBind of registry.bindings) {
      const keybind = allKeyBinds.find((kb) => kb.id === uiKeyBind.id);
      if (keybind) {
        uiKeyBind.isEnabled = keybind.defaultEnabled !== false;
      }
    }
    notifyKeyBindListChange();
  }

  /**
   * 仅重置所有快捷键的值为默认值，保留启用状态
   */
  export async function resetAllKeyBindsValues() {
    const store = await createStore("keybinds2.json");

    // 遍历所有非全局快捷键
    for (const keybind of allKeyBinds.filter((keybindItem) => !keybindItem.isGlobal)) {
      const currentConfig = await store.get<any>(keybind.id);

      // 应用Mac键位转换
      let defaultValue = keybind.defaultKey;
      if (isMac) {
        defaultValue = transEmacsKeyWinToMac(defaultValue);
      }

      // 如果存在当前配置，只重置key字段，保留isEnabled字段
      if (currentConfig) {
        await store.set(keybind.id, {
          key: defaultValue,
          isEnabled: currentConfig.isEnabled !== false,
        });
      } else {
        // 如果不存在配置，使用默认值创建
        await store.set(keybind.id, {
          key: defaultValue,
          isEnabled: keybind.defaultEnabled !== false,
        });
      }
    }

    await store.save();

    // 更新内存中的快捷键配置
    for (const uiKeyBind of registry.bindings) {
      const keybind = allKeyBinds.find((kb) => kb.id === uiKeyBind.id);
      if (keybind) {
        let defaultValue = keybind.defaultKey;
        if (isMac) {
          defaultValue = transEmacsKeyWinToMac(defaultValue);
        }
        uiKeyBind.key = defaultValue;
      }
    }
    notifyKeyBindListChange();
  }

  // 跟踪当前按下的单键快捷键（序列型）
  const pressedSingleKeyBinds = new Set<string>();

  // 跟踪当前按下的持续型快捷键（存放 id，防止重复触发）
  const pressedContinuousKeyBindIds = new Set<string>();
  let pendingToggle:
    | { timer: ReturnType<typeof setTimeout>; nextKeys: string[]; run: () => Promise<boolean> }
    | undefined;

  async function finishPendingToggle(run: boolean) {
    const pending = pendingToggle;
    if (!pending) return;
    pendingToggle = undefined;
    clearTimeout(pending.timer);
    if (run && shouldProcessKeyboardEvent()) await pending.run();
  }

  const cancelPendingToggle = () => void finishPendingToggle(false);

  function resolvePendingToggleBefore(event: KeyboardEvent | MouseEvent | WheelEvent) {
    if (!pendingToggle || (event instanceof KeyboardEvent && event.repeat)) return;
    const continuedSequence = pendingToggle.nextKeys.some((key) => matchEmacsKeyPress(key, [event]));
    return finishPendingToggle(!continuedSequence);
  }

  export function uiStartListen() {
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("blur", cancelPendingToggle);
  }

  export function uiStopListen() {
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("blur", cancelPendingToggle);
    pressedSingleKeyBinds.clear();
    pressedContinuousKeyBindIds.clear();
    cancelPendingToggle();
  }

  /**
   * 检查是否应该处理键盘事件
   * 当有文本输入元素获得焦点时，不处理键盘事件
   */
  export function shouldProcessKeyboardEvent() {
    const focused = document.activeElement;
    return !(
      focused?.tagName === "INPUT" ||
      focused?.tagName === "TEXTAREA" ||
      (focused instanceof HTMLElement && focused.isContentEditable) ||
      focused?.getAttribute("contenteditable") === "true"
    );
  }

  async function check(event: KeyboardEvent | MouseEvent | WheelEvent): Promise<boolean> {
    // 如果有文本输入元素获得焦点，不处理键盘事件
    if (!shouldProcessKeyboardEvent()) {
      // 清空队列，防止事件积累
      userEventQueue.clear();
      cancelPendingToggle();
      return false;
    }
    const repeat = event instanceof KeyboardEvent && event.repeat;
    const tab = store.get(activeTabAtom);
    const activeProject = tab instanceof Project ? tab : undefined;

    // 收集所有匹配的快捷键，按序列长度降序尝试执行，只执行最长匹配
    const matched: { uiKeyBind: UIKeyBind; seqLength: number }[] = [];
    for (const uiKeyBind of registry.bindings) {
      if (!uiKeyBind.isEnabled) continue;
      if (uiKeyBind.isContinuous) continue;
      if (repeat && (uiKeyBind.isToggle || uiKeyBind.isRepeatable === false)) continue;
      if (matchEmacsKeyPress(uiKeyBind.key, userEventQueue.arrayList)) {
        const seqLength = uiKeyBind.key.trim().split(/\s+/).length;
        matched.push({ uiKeyBind, seqLength });
      }
    }
    // 按序列长度降序排列，优先尝试最长匹配
    matched.sort((a, b) => b.seqLength - a.seqLength);

    let maxExecutedLength = -1;
    for (const { uiKeyBind, seqLength } of matched) {
      if (maxExecutedLength >= 0 && seqLength < maxExecutedLength) break;
      if (!(await uiKeyBind.when(activeProject))) continue;
      if (uiKeyBind.isToggle) {
        const nextKeys = registry.bindings
          .filter((binding) => binding.isEnabled && !binding.isContinuous)
          .flatMap((binding) => {
            const keys = binding.key.trim().split(/\s+/);
            return keys.filter(
              (_, index) =>
                index >= seqLength && matchEmacsKeyPress(keys.slice(0, index).join(" "), userEventQueue.arrayList),
            );
          });
        if (nextKeys.length > 0) {
          // 给正在输入的更长序列留出时间。
          pendingToggle = {
            timer: setTimeout(() => void finishPendingToggle(true), 250),
            nextKeys,
            run: () =>
              getFocusedProject() === activeProject && getUIKeyBind(uiKeyBind.id) === uiKeyBind
                ? execute(uiKeyBind.id, activeProject)
                : Promise.resolve(false),
          };
          return true;
        }
      }
      uiKeyBind.onPress(uiKeyBind.id.startsWith("ext:") && activeProject ? proxy(activeProject) : activeProject);
      if (uiKeyBind.onRelease && uiKeyBind.key.length === 1) {
        pressedSingleKeyBinds.add(uiKeyBind.key);
      }
      maxExecutedLength = seqLength;
    }
    if (maxExecutedLength >= 0) {
      userEventQueue.clear();
      return true;
    }
    return false;
  }

  async function onMouseDown(event: MouseEvent) {
    enqueue(event);
    if (await interceptInput(event)) {
      event.preventDefault();
      return;
    }
    if (pendingToggle) await resolvePendingToggleBefore(event);
    await check(event);
  }
  async function onMouseUp(event: MouseEvent) {
    for (const interceptor of inputInterceptors) {
      await interceptor.onMouseUp?.(event);
    }
  }
  async function onKeyDown(event: KeyboardEvent) {
    // 如果有文本输入元素获得焦点，不处理键盘事件
    if (event.isComposing || !shouldProcessKeyboardEvent()) {
      // 清空队列，防止事件积累
      userEventQueue.clear();
      cancelPendingToggle();
      return;
    }
    if (["control", "alt", "shift", "meta"].includes(event.key.toLowerCase())) return;

    const activeProject = getFocusedProject();
    if (activeProject && isMac && event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "z") {
      // macOS 原生编辑菜单可能撤销已失焦文本框中的内容，必须在异步检查前拦截。
      event.preventDefault();
    }

    enqueue(event);
    if (await interceptInput(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      cancelPendingToggle();
      if (event.defaultPrevented) {
        userEventQueue.clear();
        return;
      }
    }
    if (pendingToggle) await resolvePendingToggleBefore(event);

    // ——持续型快捷键独立路径——
    let continuousExecuted = false;
    {
      const rawKey = event.key.toLowerCase();
      // 兼容中文输入法下的全角符号（如「【」→「[」）
      const pressedKey = rawKey in transformedKeys ? transformedKeys[rawKey as keyof typeof transformedKeys] : rawKey;
      for (const uiKeyBind of registry.bindings) {
        if (!uiKeyBind.isContinuous) continue;
        if (!uiKeyBind.isEnabled) continue;
        // 解析快捷键字符串，同时比对裸键和修饰键
        const parsed = parseSingleEmacsKey(uiKeyBind.key);
        if (parsed.key !== pressedKey) continue;
        if (parsed.control !== event.ctrlKey) continue;
        if (parsed.alt !== event.altKey) continue;
        if (parsed.shift !== event.shiftKey) continue;
        if (parsed.meta !== event.metaKey) continue;
        // 防止 keydown 重复触发（按住时浏览器会持续发送 keydown 事件）
        if (pressedContinuousKeyBindIds.has(uiKeyBind.id)) continue;
        if (!(await uiKeyBind.when(activeProject))) continue;
        pressedContinuousKeyBindIds.add(uiKeyBind.id);
        uiKeyBind.onPress(activeProject);
        continuousExecuted = true;
      }
    }
    // 持续型路径处理后，不 return——序列型照常入队检测（两者不冲突）

    // ——序列型快捷键路径——
    const sequenceExecuted = await check(event);

    // 只要有快捷键被执行，就阻止浏览器默认行为（防止 Tab 跳焦点、方向键滚动页面等）
    if (continuousExecuted || sequenceExecuted) {
      event.preventDefault();
    }
  }
  async function onKeyUp(event: KeyboardEvent) {
    // 如果有文本输入元素获得焦点，不处理键盘事件
    if (!isMac && !shouldProcessKeyboardEvent()) {
      return;
    }
    for (const interceptor of inputInterceptors) {
      await interceptor.onKeyUp?.(event);
    }
    const activeProject = getFocusedProject();
    const key = event.key;

    // ——持续型快捷键松开——
    // 只比对裸键（不检查修饰键），这样松开主键即可立即停止，无需等待修饰键松开
    const rawKeyUp = key.toLowerCase();
    // 兼容中文输入法下的全角符号（如「】」→「]」）
    const keyUpNormalized =
      rawKeyUp in transformedKeys ? transformedKeys[rawKeyUp as keyof typeof transformedKeys] : rawKeyUp;
    for (const uiKeyBind of registry.bindings) {
      if (!uiKeyBind.isContinuous) continue;
      if (!uiKeyBind.isEnabled) continue;
      const parsed = parseSingleEmacsKey(uiKeyBind.key);
      if (parsed.key !== keyUpNormalized) continue;
      if (!pressedContinuousKeyBindIds.has(uiKeyBind.id)) continue;
      pressedContinuousKeyBindIds.delete(uiKeyBind.id);
      if (!(await uiKeyBind.when(activeProject))) continue;
      uiKeyBind.onRelease?.(activeProject);
    }

    // ——序列型快捷键松开——
    // 检查是否有对应的单键快捷键需要处理松开事件
    for (const uiKeyBind of registry.bindings) {
      // 如果快捷键未启用，跳过
      if (!uiKeyBind.isEnabled) continue;
      if (uiKeyBind.isContinuous) continue;
      if (uiKeyBind.onRelease && uiKeyBind.key === key && pressedSingleKeyBinds.has(key)) {
        pressedSingleKeyBinds.delete(key);
        if (!(await uiKeyBind.when(activeProject))) continue;
        uiKeyBind.onRelease(activeProject);
      }
    }
  }
  async function onWheel(event: WheelEvent) {
    enqueue(event);
    if (await interceptInput(event)) return;
    if (pendingToggle) await resolvePendingToggleBefore(event);
    await check(event);
  }

  /**
   * 获取当前按键序列的字符串表示
   * 用于在debug模式下显示当前已按下的按键序列
   */
  export function getCurrentKeySequence(): string {
    if (userEventQueue.length === 0) {
      return "";
    }
    return userEventQueue.arrayList.map((event) => formatEmacsKey(event)).join(" ");
  }
}
