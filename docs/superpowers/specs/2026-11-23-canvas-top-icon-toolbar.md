# 画布顶部图标工具栏需求说明

状态：待实现

参考：用户提供的 Excalidraw 顶部图标工具栏截图。目标是借鉴其紧凑、居中、状态明确、工具分组清晰的交互方式，不照搬其完整功能。

## 1. 背景

当前画布缺少一个始终可见、可快速理解和切换绘制状态的顶部操作入口。用户容易误触快捷键进入画笔或连线模式，但界面上没有足够明显的当前工具状态提示；同时布局、创建、组织和连线等画布相关命令分散在全局菜单与快捷键中，不够顺手。

本需求需要在画布顶部中间增加一排紧凑的图标按钮，以分组方式提供常用画布操作。

## 2. 目标

- 在画布顶部中间显示一个浮动工具栏。
- 明确显示当前鼠标左键工作模式。
- 提供选择、画笔、连线/切割三个直接可见的工具状态按钮。
- 将创建、树/图、布局、组织、连线等操作分类收纳，避免平铺全局命令。
- 分类按钮通过 hover 或点击在图标下方展开紧凑的操作弹出层。
- 操作不满足前置条件时禁用按钮，不能只做视觉变暗而仍可点击。
- 工具栏保持紧凑，不遮挡过多画布内容，不出现卡片套卡片或大面积标题。
- 工具栏执行结果与对应快捷键命令保持一致。

## 3. 非目标

- 不把所有全局菜单、设置、插件、开发工具和低频窗口入口搬进工具栏。
- 不重做画布、节点、渲染器或快捷键系统。
- 不为工具栏复制一套独立业务逻辑。
- 不改变现有快捷键的默认含义。
- 不在本次需求中新增复杂的工作区自定义布局功能。
- 不新增纯文字式功能说明或教学文案。

## 4. 信息架构

### 4.1 直接显示的工具状态

工具栏最左侧固定显示三个鼠标模式按钮，中间用分隔线与后续分类区别：

| 状态      | 图标建议                   | 设置值          |
| --------- | -------------------------- | --------------- |
| 选择/移动 | `MousePointer`             | `selectAndMove` |
| 画笔      | `Brush`                    | `draw`          |
| 连线/切割 | `Waypoints` 或 `GitBranch` | `connectAndCut` |

要求：

- 当前模式必须有明显 active 状态，例如使用主题的 primary/accent 语义色和 `aria-pressed`。
- 模式切换后图标状态应立即更新。
- 画笔模式被激活时，保留或重新接入现有画笔颜色快捷选择条。
- 鼠标模式不应仅在应用启动时才恢复默认；用户应能从工具栏随时切回选择模式。

### 4.2 分类工具栏

分类按钮默认只显示一个代表图标。hover 或点击后，在按钮下方展开操作面板。操作面板内的子操作以图标按钮为主，tooltip 显示名称和快捷键。

建议分类如下。

#### 创建

- `createTextNodeFromCameraLocation`
- `createTextNodeFromMouseLocation`
- `createConnectPointFromMouseLocation`
- `createTextNodeFromSelectedTop`
- `createTextNodeFromSelectedRight`
- `createTextNodeFromSelectedLeft`
- `createTextNodeFromSelectedDown`

建议在弹出层内部再分为“空白画布创建”和“基于选中节点创建”两行，避免条件混杂。

#### 树 / 图

- `generateNodeTreeWithDeepMode`
- `generateNodeTreeWithBroadMode`
- `generateNodeTreeWithDeepModeEditEdge`

如首版暂不解决“键盘专用模式”门控问题，这三项可以先不展示，不能以会静默失效的按钮形式上线。

#### 布局

布局弹出层内部按用途分组，不将全部按钮平铺成一大排。

对齐：

- `alignTop`
- `alignBottom`
- `alignLeft`
- `alignRight`
- `alignCenterHorizontal`
- `alignCenterVertical`

分布与紧凑排列：

- `alignHorizontalSpaceBetween`
- `alignVerticalSpaceBetween`
- `alignLeftToRightNoSpace`
- `alignTopToBottomNoSpace`

方形排列与自动布局：

- `layoutToSquare`
- `layoutToTightSquare`
- `layoutToTightSquareDeep`
- `dagGraphAdjust`

#### 组织

- `packEntityToSection`
- `textNodeToSection`
- `unpackEntityFromSection`
- `folderSection`
- `toggleSectionLock`
- `createTwinTextNode`

弹出层内部按“打包/解包”“章节”“节点操作”排列。

#### 连线

- `connectAllSelectedEntities`
- `connectLeftToRight`
- `connectTopToBottom`
- `createUndirectedEdgeFromEntities`
- `createMTUEdgeConvex`

#### 更多

使用 `Ellipsis` 图标收纳低频但有用的画布命令或窗口入口。候选包括：

- `undo`
- `redo`
- `copy`
- `paste`
- `selectAll`
- `deleteSelectedStageObjects`
- `openOutlineWindow`
- `openAIPanel`
- `openAITools`
- `openColorPanel`

“更多”只收纳确实需要的画布相关低频命令，不应变成第二个完整全局菜单。

## 5. 布局与视觉

- 工具栏位于画布顶部中间，水平居中。
- 使用单层浮动工具条，不额外包大卡片或标题区域。
- 高度保持紧凑，普通图标按钮使用现有 shadcn `Button` 的 icon size。
- 分组之间使用细分隔线，不使用厚重边框。
- 使用现有主题语义色，例如 `bg-popover`、`border-border`、`text-muted-foreground`、active 状态使用 `primary` 或 `accent`，不要硬编码颜色。
- 图标按钮关闭默认 focus 轮廓后必须保留可见的键盘 focus 状态。
- 弹出层应与触发按钮对齐，不能超出画布可见区域。
- 窄窗口下优先收起低频分类到“更多”，不能把工具栏压成多行或遮挡画布中心。
- 工具栏层级应高于画布，但低于 Dialog、模态窗口和必要的系统级浮层。
- 课堂/专注模式可沿用现有画布浮层的隐藏策略，避免破坏演示界面。

## 6. 交互规则

- 直接工具按钮点击后立即切换鼠标模式。
- 分类按钮支持 hover 展开；离开触发区和弹出层后延迟关闭，避免鼠标移动到子项时误关。
- 分类按钮同时支持点击切换，保证触摸设备和键盘可操作。
- 子操作点击后执行命令并关闭弹出层。
- 触发区、弹出层和子按钮应支持键盘 focus、Enter 和 Space。
- 禁用按钮不能被点击，也不能触发命令。
- 禁用按钮仍可通过 tooltip 说明原因；如果无法提供精确原因，至少说明该操作需要选中节点、多个节点或指定类型的节点。
- 选择状态变化时，已打开的弹出层中的按钮禁用状态应同步更新。
- 切换画布工具后，不应自动清空当前选择。

## 7. 状态来源与命令执行

### 7.1 鼠标模式

鼠标模式唯一状态来源是 `Settings.mouseLeftMode`。

实现要求：

- 使用 `Settings.use("mouseLeftMode")` 订阅变化。
- 不要再用依赖 `Settings.mouseLeftMode` 的 `useEffect` 模拟订阅。
- 切换模式时写入 `Settings.mouseLeftMode`。
- 三个模式命令当前受 `whenKeyboardOnlyOpen` 门控，不能在普通画布中直接通过 `KeyBindsUI.execute` 执行。工具栏模式切换应直接更新 `Settings.mouseLeftMode`，或先将模式切换动作抽成可安全复用的公共函数。

### 7.2 其他命令

优先复用 `app/src/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister.tsx` 中已注册的命令，通过 `KeyBindsUI` 执行，不复制布局、连接、章节和节点业务逻辑。

基础调用位置：

- `KeyBindsUI.execute(id, project)`
- `KeyBindsUI.canExecute(id, project)`
- `KeyBindsUI.getUIKeyBind(id)`

禁用判断至少包含：

```ts
const binding = KeyBindsUI.getUIKeyBind(id);
const disabled = !binding?.isEnabled || (await binding?.when(project)) === false;
```

如果 `when` 是同步函数，应优先同步计算，避免大量异步状态更新。

### 7.3 已知门控问题

当前大量创建、树生成、编辑和窗口操作命令带有 `whenKeyboardOnlyOpen` 门控，部分 `onPress` 内部还会再次检查 `keyboardOnlyEngine.isOpenning()`。

这意味着：

- 不能假设所有命令都能被工具栏直接复用。
- 不能只绕过 `when` 后调用 `onPress`，因为内部守卫仍会让操作静默失败。
- 不能在工具栏复制一份完整业务逻辑，否则快捷键与工具栏后续容易行为不一致。

实现时选择一个最小方案：

1. 只上线能够通过现有命令系统安全执行的分类和子项。
2. 对首版必须提供的键盘专用命令，抽出可复用的纯动作函数，并区分“快捷键触发条件”和“工具栏可用条件”。

如果采用第 2 种方案，推荐给快捷键注册项增加独立的 toolbar 可用条件，由工具栏执行路径检查该条件；快捷键仍保留原门控。不要通过临时打开键盘专用模式来绕过限制。

## 8. 选中状态响应

工具栏中的布局、组织和连线按钮必须在选择变化后立即更新禁用状态。

现状风险：

- 节点选中状态通过各 `StageObject.isSelected` 直接读写。
- 不一定存在统一通知 Project/Tab React 组件重渲染的选择变更事件。

实现要求：

- 优先在 `StageManager` 或现有选择入口增加轻量的选择版本号、快照或事件订阅。
- 工具栏只订阅“选择摘要”，例如选中对象数量、实体类型、关系类型等，不逐帧读取和重渲染全部节点。
- 如果首版使用轻量轮询，只允许低频比较选择摘要，不允许每帧重渲染整个工具栏。
- 选择摘要变化后才重新计算按钮禁用状态。

## 9. 代码落点

优先在现有文件中完成，避免拆成大量小文件。

- 现有工具栏组件：`app/src/components/toolbar-content.tsx`
- Project 画布容器：`app/src/core/Project.tsx` 中的 `getComponent()`
- 命令注册：`app/src/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister.tsx`
- 命令 UI 管理：`app/src/core/service/controlService/shortcutKeysEngine/KeyBindsUI.tsx`
- 鼠标模式设置：`app/src/core/service/Settings.tsx`
- 选择对象读取：`app/src/core/stage/stageManager/StageManager.tsx`

推荐做法：

- 将现有未挂载的底部工具栏改造为顶部工具状态栏，或在同一组件中复用鼠标模式部分。
- 在 `Project.getComponent()` 的画布容器中，与 `RightToolbar` 同级挂载顶部工具栏。
- 工具栏必须接收当前 `Project`，不能总是依赖全局 active project，尤其要注意侧栏、子窗口和多标签页场景。

## 10. UI 组件约束

- 使用现有 shadcn `Button`、`Tooltip`、`Popover` 和 `Separator`。
- `Popover` 默认不提供 hover 开合，需使用受控 `open` 状态，并在 `onPointerEnter`、`onPointerLeave`、focus 和 blur 时协调开合。
- hover 关闭需要短暂延迟，避免鼠标从触发按钮移动到弹出层时闪烁。
- 图标使用 `lucide-react`。
- Button 内的图标使用 `data-icon`，不要手动指定冲突的宽高。
- 新文案使用 i18n：
  - 修改 `app/src/locales/zh_CN.yml`
  - 修改 `app/src/locales/en.yml`
  - 需要时同步维护 `zh_TWC.yml` 和 `id.yml`
  - 不手改自动生成的 `zh_TW.yml`

## 11. 验收标准

- 画布顶部中间出现紧凑的水平图标工具栏。
- 选择、画笔、连线/切割三种状态始终可见，active 状态清晰。
- 在画笔模式误激活后，可以直接点击选择按钮恢复。
- 创建、树/图、布局、组织、连线、更多均按分类收纳，没有把所有命令平铺出来。
- 布局分类 hover 或点击后，在下方展示分类后的多个布局操作。
- 至少两个节点未选中时，对齐、分布、方形排列和多节点连线按钮处于禁用状态且不可执行。
- 单选、多选、Section 和 TextNode 等条件变化后，按钮禁用状态及时更新。
- 每个可用按钮执行后的结果与对应快捷键相同。
- 窄窗口下工具栏不会溢出错位，不会把画布中心大范围遮挡。
- tooltip、键盘 focus、Enter/Space 和禁用态可正常工作。
- 不新增静默失败、只 `console.error` 或重复业务逻辑。
- 课堂/专注模式、多标签页和子窗口打开时没有出现工具栏错位或 Project 绑定错误。

## 12. 验证方式

- 为工具栏的选择摘要和禁用条件增加聚焦测试。
- 覆盖 active 工具状态、单选/多选禁用、分类弹出层开合和命令调用。
- 运行：

```bash
pnpm --filter @graphif/project-graph type-check
```

- 运行相关 Vitest 测试。
- 必要时运行 lint。
- 不运行 `build`、`build:ci`、`build:no-tauri` 或 Tauri build。
- 如开发环境可用，手动验证桌面宽度、窄窗口、画笔模式、单节点选择、多节点选择、Section 选择和禁用按钮。

## 13. 新对话执行提示

可以将下面这段直接作为新对话的任务说明：

```text
请按照 docs/superpowers/specs/2026-11-23-canvas-top-icon-toolbar.md 实现画布顶部图标工具栏。

先检查当前工作区和相关代码状态，再开始改动。重点确认：
1. Settings.mouseLeftMode 的响应式订阅。
2. Project.getComponent() 中的挂载位置。
3. KeyBindsUI 命令执行和禁用条件。
4. keyboardOnlyEngine 门控是否会令工具栏操作静默失效。
5. 选择状态变化时如何让禁用状态及时刷新。

按文档中的分类、交互、禁用条件和验收标准实现。不要运行 build，最终使用 type-check 验证。
```
