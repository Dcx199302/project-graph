import { Project, service } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { AIChatSessionStore } from "@/core/service/dataManageService/aiEngine/AIChatSessionStore";
import { composeAgentSystemPrompt, mergeAgentToolSets } from "@/core/service/dataManageService/aiEngine/AIAgentRuntime";
import {
  createSessionMemoryCompactionPlan,
  formatSessionMemoryTranscript,
  getSessionMemoryWorkingMessages,
} from "@/core/service/dataManageService/aiEngine/AIChatSessionMemory";
import { createBuiltInToolAgentTools } from "@/core/service/dataManageService/aiEngine/BuiltInToolAgentAdapter";
import { AIMCPStore, materializeMCPServers, prepareMCPTools } from "@/core/service/dataManageService/aiEngine/AIMCP";
import { AIObjectReferenceRegistry } from "@/core/service/dataManageService/aiEngine/AIObjectReferenceRegistry";
import { AIProjectReferenceStore } from "@/core/service/dataManageService/aiEngine/AIProjectReferenceStore";
import { parseAIRequestHeaders } from "@/core/service/dataManageService/aiEngine/AIRequestHeaders";
import { resolveHttpRequestBody } from "@/core/service/dataManageService/aiEngine/AIHttpBody";
import {
  AIRequestTraceBuffer,
  type AIRequestTraceCallKind,
} from "@/core/service/dataManageService/aiEngine/AIRequestTrace";
import {
  buildSkillSystemContext,
  filterActivatedSkillSnapshots,
} from "@/core/service/dataManageService/aiEngine/AISkillSession";
import {
  AISkillTrustStore,
  createSkillTools,
  discoverSkills,
} from "@/core/service/dataManageService/aiEngine/AISkills";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch } from "@tauri-apps/plugin-http";
import {
  convertToModelMessages,
  DefaultChatTransport,
  generateText,
  pruneMessages,
  stepCountIs,
  streamText,
  type UIMessage,
  wrapLanguageModel,
} from "ai";

const SYSTEM_PROMPT = [
  "优先使用工具解决问题，仅在缺少必要信息且无法通过工具获得时询问用户。",
  "生成图时，负责确定节点内容、层级、连线及其方向和含义。节点位置、间距和整体排布由软件布局工具计算。不要生成坐标、偏移量或自行安排位置。",
  "新建树图优先用 generate_node_tree_by_text，首行写实际主题。扩展选中的树图时，先读取选中节点引用，再用 expand_node_tree_from_node 把新增子树接到该节点，已有分组和新增分支的排布由软件处理。",
  "需要逐个创建节点时，先创建节点和关系，完成连线后再按需对本次生成或用户指定的节点调用一次匹配的布局。树状层级用 layout_nodes 的 mind_map，有环或围绕中心的关系图可用 rectangle，无连线的节点可用 grid_horizontal 或 grid_vertical，明确需要分层的有向无环图可用 auto_layout_dag。仅在需要调整现有间距时用 increase_spacing 或 decrease_spacing。只生成单个节点或创建工具已完成所需布局时，无需再调用布局。",
  "画布已经展示生成结果。写入画布后，用一两句话汇报实际完成的内容和必要的关键节点引用。除非用户明确要求，不要在聊天里重复完整的节点、连线列表、缩进树、JSON 或图表代码。",
  "节点默认使用透明背景，文本仍然可见。使用工具返回的项目对象引用（如 n1、n2、e1），这些引用在同一项目的不同会话间保持一致。不要猜测引用，提及对象时用反引号包裹引用，以便用户点击定位。",
  "MCP 工具被用户拒绝后，不要在当前任务中重新尝试该调用，也不要用等价参数绕过拒绝。",
].join("\n");

export type AIMessageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  lastStepInputTokens?: number;
  lastStepOutputTokens?: number;
};

@service("aiEngine")
export class AIEngine {
  private references: AIObjectReferenceRegistry | undefined;
  private referencesInitialization: Promise<AIObjectReferenceRegistry> | undefined;
  private readonly requestTraceBuffer = new AIRequestTraceBuffer(20);

  getProjectReferences(project: Project) {
    this.references ??= new AIObjectReferenceRegistry(project);
    return this.references;
  }

  prepareProjectReferences(project: Project): Promise<AIObjectReferenceRegistry> {
    const references = this.getProjectReferences(project);
    this.referencesInitialization ??= AIProjectReferenceStore.load(project).then((snapshot) => {
      if (snapshot) references.restoreSnapshot(snapshot);
      return references;
    });
    return this.referencesInitialization;
  }

  getRequestTraceBuffer() {
    return this.requestTraceBuffer;
  }

  createConversation(
    project: Project,
    references = this.getProjectReferences(project),
    getContextWindowTokenLimit: () => number | undefined = () => undefined,
  ) {
    const transport = new DefaultChatTransport({
      api: "/api/project-graph-ai-chat",
      fetch: this.createChatFetch(project, references),
      body: () => {
        const contextWindowTokenLimit = getContextWindowTokenLimit();
        return contextWindowTokenLimit && contextWindowTokenLimit > 0 ? { contextWindowTokenLimit } : {};
      },
    });
    return { references, transport };
  }

  createChatFetch(project: Project, references: AIObjectReferenceRegistry): typeof fetch {
    return async (_url, options) => {
      const body = await this.readRequestBody(options?.body);
      const messages = Array.isArray(body.messages) ? (body.messages as UIMessage<AIMessageMetadata>[]) : [];
      const sessionId = typeof body.id === "string" && body.id.length > 0 ? body.id : undefined;
      const modelId = Settings.aiModel;
      const traceRunId = this.requestTraceBuffer.startRun({
        sessionId,
        model: modelId,
        messages,
      });
      const pendingTraceCallIds: number[] = [];
      let traceCallKind: AIRequestTraceCallKind = "agent";

      const provider = createOpenAICompatible({
        name: "project-graph",
        baseURL: Settings.aiApiBaseUrl,
        apiKey: Settings.aiApiKey || undefined,
        fetch: async (url: any, init: any) => {
          const traceCallId = pendingTraceCallIds.shift();
          const wireRequestId = this.requestTraceBuffer.recordWireRequest(
            traceRunId,
            traceCallId,
            url.toString(),
            init?.body,
          );
          try {
            const requestBody = await resolveHttpRequestBody(init?.body);
            const finalHeaders: Record<string, string> = {
              ...(init?.headers instanceof Headers
                ? Object.fromEntries((init.headers as Headers).entries())
                : init?.headers),
              ...parseAIRequestHeaders(Settings.aiCustomHeaders),
            };
            const response = await fetch(url.toString(), {
              ...init,
              body: requestBody,
              headers: finalHeaders,
              mode: "cors",
            });
            this.requestTraceBuffer.recordWireResponse(traceRunId, wireRequestId, response.status);

            if (!response.ok) {
              const errorText = await response.text().catch(() => "unknown error");
              throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
            }

            return response;
          } catch (error) {
            this.requestTraceBuffer.recordWireError(traceRunId, wireRequestId, error);
            throw error;
          }
        },
        includeUsage: true,
      });

      const model = wrapLanguageModel({
        model: provider.chatModel(modelId),
        middleware: {
          specificationVersion: "v3",
          wrapGenerate: async ({ doGenerate, params }) => {
            const callId = this.requestTraceBuffer.recordModelCall(traceRunId, traceCallKind, params);
            pendingTraceCallIds.push(callId);
            try {
              return await doGenerate();
            } finally {
              const pendingIndex = pendingTraceCallIds.indexOf(callId);
              if (pendingIndex >= 0) pendingTraceCallIds.splice(pendingIndex, 1);
            }
          },
          wrapStream: async ({ doStream, params }) => {
            const callId = this.requestTraceBuffer.recordModelCall(traceRunId, traceCallKind, params);
            pendingTraceCallIds.push(callId);
            try {
              return await doStream();
            } finally {
              const pendingIndex = pendingTraceCallIds.indexOf(callId);
              if (pendingIndex >= 0) pendingTraceCallIds.splice(pendingIndex, 1);
            }
          },
        },
      });
      const contextWindowTokenLimit = getContextWindowTokenLimit(body.contextWindowTokenLimit);
      let sessionMemory = sessionId
        ? await AIChatSessionStore.getSessionMemory(project.uri.toString(), sessionId)
        : undefined;
      let workingMessages = getSessionMemoryWorkingMessages(messages, sessionMemory);
      const compactionPlan = sessionId
        ? createSessionMemoryCompactionPlan({
            messages,
            memory: sessionMemory,
            contextWindowTokens: contextWindowTokenLimit,
          })
        : null;

      if (compactionPlan && sessionId) {
        traceCallKind = "memory-summary";
        const summaryResult = await generateText({
          model,
          system:
            "你负责维护一个 AI 会话的内部记忆。根据给出的旧会话记录生成简短、准确的续写记忆。只保留当前任务、已完成内容、关键约束或决定、未解决的问题和下一步。不要执行工具，不要与用户对话，不要编造未出现的事实。",
          prompt: [
            sessionMemory ? `已有会话记忆：\n${sessionMemory.summary}` : "尚无已有会话记忆。",
            `需要压缩的旧会话记录：\n${formatSessionMemoryTranscript(compactionPlan.messagesToSummarize)}`,
          ].join("\n\n"),
          maxOutputTokens: compactionPlan.maxOutputTokens,
          abortSignal: options?.signal ?? undefined,
          maxRetries: 0,
        });
        traceCallKind = "agent";
        const summary = summaryResult.text.trim();
        if (!summary) throw new Error("AI 会话记忆压缩未返回内容");
        sessionMemory = {
          summary,
          coveredMessageCount: compactionPlan.nextCoveredMessageCount,
        };
        await AIChatSessionStore.setSessionMemory(project.uri.toString(), sessionId, sessionMemory);
        workingMessages = compactionPlan.retainedMessages;
      }

      const projectUri = project.uri.toString();
      const projectSkillsTrusted =
        project.uri.scheme === "file" && (await AISkillTrustStore.isProjectTrusted(projectUri));
      const activatedSkills = filterActivatedSkillSnapshots(
        sessionId ? await AIChatSessionStore.getActivatedSkills(projectUri, sessionId) : [],
        projectSkillsTrusted,
      );
      const skillCatalog = await discoverSkills(projectUri);
      const skillTools = createSkillTools({
        catalog: skillCatalog,
        activatedSkills,
        onActivate: async (snapshot) => {
          if (!sessionId) throw new Error("当前 AI 请求缺少会话，无法激活 Skill");
          await AIChatSessionStore.activateSkill(projectUri, sessionId, snapshot);
        },
      });
      const mcpRuntime = await prepareMCPTools(materializeMCPServers(await AIMCPStore.load()), {
        requireApproval: !Settings.aiAutoApproveMcpTools,
      });

      try {
        const tools = mergeAgentToolSets(
          createBuiltInToolAgentTools(project, references),
          mcpRuntime.tools,
          skillTools,
        );
        const skillContext = buildSkillSystemContext(skillCatalog, activatedSkills);
        const memoryContext = sessionMemory
          ? `以下是当前会话的压缩记忆，仅用于保持对话连续性。当前用户消息和工具读取到的项目状态优先。\n${sessionMemory.summary}`
          : undefined;
        const system = composeAgentSystemPrompt(SYSTEM_PROMPT, skillContext, memoryContext);
        const modelMessages = pruneMessages({
          messages: await convertToModelMessages(workingMessages, {
            tools,
            ignoreIncompleteToolCalls: true,
          }),
          reasoning: "all",
        });
        this.requestTraceBuffer.recordPreparedInput(traceRunId, {
          system,
          messages: modelMessages,
        });

        let lastStepUsage: { inputTokens?: number; outputTokens?: number } | undefined;
        const textStream = streamText({
          model,
          system,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(8),
          abortSignal: options?.signal ?? undefined,
          maxRetries: 0,
          onStepFinish: ({ usage }) => {
            lastStepUsage = usage;
          },
          onFinish: mcpRuntime.close,
          onError: mcpRuntime.close,
          onAbort: mcpRuntime.close,
        });

        return textStream.toUIMessageStreamResponse<UIMessage<AIMessageMetadata>>({
          originalMessages: messages as UIMessage<AIMessageMetadata>[],
          messageMetadata: ({ part }) => {
            if (part.type !== "finish") return;
            return {
              inputTokens: part.totalUsage.inputTokens,
              outputTokens: part.totalUsage.outputTokens,
              totalTokens: part.totalUsage.totalTokens,
              lastStepInputTokens: lastStepUsage?.inputTokens,
              lastStepOutputTokens: lastStepUsage?.outputTokens,
            };
          },
        });
      } catch (error) {
        await mcpRuntime.close();
        throw error;
      }
    };
  }

  async getModels() {
    return ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
  }

  private async readRequestBody(body: BodyInit | null | undefined): Promise<any> {
    if (!body) return {};
    if (typeof body === "string") return JSON.parse(body);
    if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
    if (body instanceof Blob) return JSON.parse(await body.text());
    if (body instanceof FormData) return Object.fromEntries(body.entries());
    if (body instanceof ReadableStream) return JSON.parse(await new Response(body).text());
    return JSON.parse(String(body));
  }
}

function getContextWindowTokenLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
