// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInstance } from "i18next";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { MessageBubble } from "./AIWindow";

vi.mock("@/core/Project", () => ({ Project: class Project {} }));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({}));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({}));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({}));
vi.mock("@/core/subWindowOpen", () => ({}));
vi.mock("@/core/TabWorkspace", () => ({}));
vi.mock("@/state", () => ({}));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

type MessageParts = ComponentProps<typeof MessageBubble>["message"]["parts"];

describe("AI chat messages", () => {
  const i18n = createInstance();
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    const zh_CN = parse(readFileSync(resolve(import.meta.dirname, "../locales/zh_CN.yml"), "utf8"));
    await i18n.init({ lng: "zh_CN", resources: { zh_CN } });
  });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderMessage(parts: MessageParts, onToolApproval = vi.fn(async () => {})) {
    act(() => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <MessageBubble
            message={{ id: "message", role: "assistant", parts }}
            project={{} as never}
            selectedCount={0}
            isStreaming={false}
            onToolApproval={onToolApproval}
          />
        </I18nextProvider>,
      );
    });
    return onToolApproval;
  }

  function getButton(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
    if (!button) throw new Error(`Missing button: ${label}`);
    return button;
  }

  it("groups completed steps into one disclosure while keeping pending approval and the short answer visible", async () => {
    const onToolApproval = renderMessage([
      { type: "reasoning", text: "检查选区", state: "done" },
      {
        type: "tool-get_selected_refs",
        toolCallId: "read",
        state: "output-available",
        input: {},
        output: ["n1", "n2"],
      },
      { type: "step-start" },
      {
        type: "tool-layout_nodes",
        toolCallId: "layout",
        state: "output-available",
        input: {},
        output: { success: true },
      },
      {
        type: "dynamic-tool",
        toolName: "mcp__example__review",
        toolCallId: "review",
        state: "approval-requested",
        input: {},
        approval: { id: "approval-1" },
      },
      { type: "text", text: "已整理选区。" },
    ]);

    expect(container.textContent).toContain("已整理选区。");
    expect(container.textContent).not.toContain("检查选区");
    expect(container.querySelectorAll('button[aria-expanded="false"]')).toHaveLength(1);
    expect(getButton("执行过程").textContent).toContain("2 次工具调用");

    await act(async () => getButton("允许本次调用").click());
    expect(onToolApproval).toHaveBeenCalledWith("approval-1", true);
    act(() => getButton("执行过程").click());
    expect(container.textContent).toContain("检查选区");
    expect(container.textContent).toContain("layout_nodes");
  });

  it("keeps a long graph reply out of the transcript until expanded", () => {
    const graph = Array.from({ length: 13 }, (_, index) => `节点 ${index + 1}`).join("\n");
    renderMessage([{ type: "text", text: graph }]);

    expect(container.textContent).not.toContain("节点 13");
    act(() => getButton("查看详细回复").click());
    expect(container.textContent).toContain(graph);
  });
});
