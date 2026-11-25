import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Project } from "@/core/Project";
import {
  AIChatSessionStore,
  type AIChatSessionProjectState,
  type AIChatSessionSummary,
  type StoredAIChatSession,
} from "@/core/service/dataManageService/aiEngine/AIChatSessionStore";
import type { AIMessageMetadata } from "@/core/service/dataManageService/aiEngine/AIEngine";
import {
  resolveAIModelContextWindow,
  type AIModelContextWindow,
} from "@/core/service/dataManageService/aiEngine/AIModelContextWindow";
import { AIObjectReferenceRegistry } from "@/core/service/dataManageService/aiEngine/AIObjectReferenceRegistry";
import { AIProjectReferenceStore } from "@/core/service/dataManageService/aiEngine/AIProjectReferenceStore";
import { getAIToolPartName, isAIToolPart } from "@/core/service/dataManageService/aiEngine/AIToolUIPart";
import { Settings } from "@/core/service/Settings";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { createSubWindow } from "@/core/subWindowOpen";
import { TabWorkspace } from "@/core/TabWorkspace";
import { activeResourceTabAtom } from "@/state";
import { cn } from "@/utils/cn";
import { AIRequestTraceView } from "@/sub/AIRequestTraceView";
import { useChat } from "@ai-sdk/react";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { code } from "@streamdown/code";
import { lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";
import { useAtom } from "jotai";
import {
  ArrowDown,
  Bot,
  Check,
  ChevronRight,
  FolderOpen,
  History,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { getOriginalNameOf } from "virtual:original-class-name";

let pendingInitialText: string | null = null;
let pendingInitialPrompt: string | null = null;

export function setAIWindowInitialText(text: string, prompt?: string) {
  pendingInitialText = text;
  pendingInitialPrompt = prompt || null;
}

export default function AIWindow({ tabId }: { tabId: string }) {
  const [tab] = useAtom(activeResourceTabAtom);
  const project = tab instanceof Project ? tab : undefined;

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <FolderOpen className="text-muted-foreground size-10" />
        <div className="font-medium">请先打开一个文件</div>
        <div className="text-muted-foreground max-w-64 text-sm">
          AI 工具需要当前画布上下文，打开文件后就可以帮你创建、整理和修改节点。
        </div>
      </div>
    );
  }

  return <AIChatWorkspace key={project.uri.toString()} project={project} tabId={tabId} />;
}

function getContrastTextColor(bg: Color): string {
  const luminance = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
  return luminance > 0.6 ? "#000" : "#fff";
}

function isEntity(
  obj: unknown,
): obj is { isSelected: boolean; collisionBox: { getRectangle(): Rectangle }; color?: Color } {
  return typeof obj === "object" && obj !== null && "isSelected" in obj && "collisionBox" in obj;
}

type ContextWindowState =
  | { status: "loading" }
  | { status: "ready"; info: AIModelContextWindow }
  | { status: "unknown" }
  | { status: "error"; message: string };

function createAnswerNode(answerText: string, project: Project) {
  if (!answerText) {
    toast.error("该消息没有可落盘的文本");
    return;
  }
  const selected = project.stageManager.getSelectedEntities();
  const source = selected.find((e) => e instanceof Section) ?? selected.find((e) => e instanceof ConnectableEntity);
  if (!source) {
    toast.error("请先选中要指向的分组框或节点");
    return;
  }
  const sourceRect = source.collisionBox.getRectangle();
  const node = new TextNode(project, {
    text: answerText,
    color: new Color(0, 0, 0, 0),
    collisionBox: new CollisionBox([
      new Rectangle(
        new Vector(sourceRect.location.x + sourceRect.size.x + 100, sourceRect.location.y),
        new Vector(100, 50),
      ),
    ]),
    sizeAdjust: "auto",
  });
  project.stageManager.add(node);
  project.nodeConnector.connectConnectableEntity(source, node);
  project.historyManager.recordStep();
  project.camera.bombMove(node.geometryCenter);
}

type ActiveChatController = {
  save: () => Promise<void>;
};

function formatSessionUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function AIChatWorkspace({ project, tabId }: { project: Project; tabId: string }) {
  const projectUri = project.uri.toString();
  const [model] = Settings.use("aiModel");
  const [sessionState, setSessionState] = useState<AIChatSessionProjectState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [operationInProgress, setOperationInProgress] = useState(false);
  const operationInProgressRef = useRef(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingSession, setDeletingSession] = useState<AIChatSessionSummary | null>(null);
  const activeChatController = useRef<ActiveChatController | null>(null);
  const references = useMemo(() => project.aiEngine.getProjectReferences(project), [project]);

  useEffect(
    () =>
      references.subscribe((snapshot) => {
        void AIProjectReferenceStore.save(project, snapshot).catch((saveError) => {
          toast.error(`AI 项目引用保存失败: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
        });
      }),
    [project, references],
  );

  useEffect(() => {
    let cancelled = false;
    setSessionState(null);
    setLoadError(null);
    Promise.all([project.aiEngine.prepareProjectReferences(project), AIChatSessionStore.initializeProject(projectUri)])
      .then(([, initialSessionState]) => {
        if (cancelled) return;
        setSessionState(initialSessionState);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [project, projectUri]);

  async function saveCurrentSession() {
    await activeChatController.current?.save();
  }

  async function runSessionOperation(operation: () => Promise<void>) {
    if (requesting || operationInProgressRef.current) return;
    operationInProgressRef.current = true;
    setOperationInProgress(true);
    try {
      await operation();
    } catch (error) {
      toast.error(`AI 会话操作失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      operationInProgressRef.current = false;
      setOperationInProgress(false);
    }
  }

  function handleCreateSession() {
    void runSessionOperation(async () => {
      await saveCurrentSession();
      const nextState = await AIChatSessionStore.createSession(projectUri);
      setSessionState(nextState);
      setHistoryOpen(false);
    });
  }

  function handleSwitchSession(sessionId: string) {
    if (!sessionState || sessionState.index.activeSessionId === sessionId) {
      setHistoryOpen(false);
      return;
    }
    void runSessionOperation(async () => {
      await saveCurrentSession();
      const nextState = await AIChatSessionStore.setActiveSession(projectUri, sessionId);
      setSessionState(nextState);
      setHistoryOpen(false);
    });
  }

  function startRenaming(session: AIChatSessionSummary) {
    setRenamingSessionId(session.id);
    setRenameDraft(session.title);
  }

  function handleRenameSession() {
    const sessionId = renamingSessionId;
    if (!sessionId || !renameDraft.trim()) return;
    void runSessionOperation(async () => {
      const nextState = await AIChatSessionStore.renameSession(projectUri, sessionId, renameDraft);
      setSessionState(nextState);
      setRenamingSessionId(null);
      setRenameDraft("");
    });
  }

  function handleDeleteRequest(session: AIChatSessionSummary) {
    if (session.messageCount > 0) {
      setDeletingSession(session);
      return;
    }
    deleteSession(session.id);
  }

  function deleteSession(sessionId: string) {
    void runSessionOperation(async () => {
      if (sessionState?.index.activeSessionId === sessionId) await saveCurrentSession();
      const nextState = await AIChatSessionStore.deleteSession(projectUri, sessionId);
      setSessionState(nextState);
      setDeletingSession(null);
      setRenamingSessionId(null);
    });
  }

  function handleClose() {
    void runSessionOperation(async () => {
      await saveCurrentSession();
      TabWorkspace.close(tabId);
    });
  }

  const actionsDisabled = requesting || operationInProgress || !sessionState;

  return (
    <div className="bg-background flex h-full flex-col">
      <div
        data-pg-drag-region
        className="border-border/70 bg-card flex shrink-0 items-center gap-2 border-b px-4 py-2.5"
      >
        <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {sessionState?.activeSession.title ?? "Project Graph AI"}
          </div>
          <div className="text-muted-foreground truncate text-xs">{model}</div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="会话历史"
              disabled={!sessionState}
              onClick={() => setHistoryOpen(true)}
            >
              <History />
            </Button>
          </TooltipTrigger>
          <TooltipContent>会话历史</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="新建会话"
              disabled={actionsDisabled}
              onClick={handleCreateSession}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新建会话</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭 AI 窗口"
          disabled={requesting || operationInProgress}
          onClick={handleClose}
        >
          <X />
        </Button>
      </div>

      {loadError ? (
        <div className="text-destructive flex flex-1 items-center justify-center p-6 text-center text-sm">
          AI 会话加载失败：{loadError}
        </div>
      ) : !sessionState ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">正在加载 AI 记忆…</div>
      ) : (
        <AIChatPanel
          key={sessionState.activeSession.id}
          project={project}
          session={sessionState.activeSession}
          references={references}
          onControllerChange={(controller) => {
            activeChatController.current = controller;
          }}
          onRequestingChange={setRequesting}
          onSessionSaved={setSessionState}
        />
      )}

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-72 sm:max-w-72">
          <SheetHeader>
            <SheetTitle>会话历史</SheetTitle>
            <SheetDescription>每个会话保留独立的聊天上下文，共享当前项目的节点引用。</SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1 px-3 pb-4">
            <div className="flex flex-col gap-1">
              {sessionState?.index.sessions.map((session) => {
                const isActive = session.id === sessionState.index.activeSessionId;
                const isRenaming = renamingSessionId === session.id;
                return (
                  <div
                    key={session.id}
                    className={cn("flex items-center rounded-md", isActive && "bg-accent text-accent-foreground")}
                  >
                    {isRenaming ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1 p-1">
                        <Input
                          autoFocus
                          aria-label="会话标题"
                          value={renameDraft}
                          disabled={operationInProgress}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") handleRenameSession();
                            if (event.key === "Escape") setRenamingSessionId(null);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="保存标题"
                          disabled={!renameDraft.trim() || operationInProgress}
                          onClick={handleRenameSession}
                        >
                          <Check />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={actionsDisabled}
                        onClick={() => handleSwitchSession(session.id)}
                      >
                        <span className="w-full truncate text-sm font-medium">{session.title}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatSessionUpdatedAt(session.updatedAt)} · {session.messageCount} 条消息
                        </span>
                      </button>
                    )}
                    {!isRenaming && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${session.title} 的操作`}
                            disabled={actionsDisabled}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => startRenaming(session)}>
                              <Pencil />
                              重命名
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => handleDeleteRequest(session)}>
                              <Trash2 />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingSession} onOpenChange={(open) => !open && setDeletingSession(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话？</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingSession?.title}”中的聊天记录会从本地删除，但该会话已经修改的画布内容不会撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={operationInProgress}
              onClick={() => deletingSession && deleteSession(deletingSession.id)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AIChatPanel({
  project,
  session,
  references,
  onControllerChange,
  onRequestingChange,
  onSessionSaved,
}: {
  project: Project;
  session: StoredAIChatSession;
  references: AIObjectReferenceRegistry;
  onControllerChange: (controller: ActiveChatController | null) => void;
  onRequestingChange: (requesting: boolean) => void;
  onSessionSaved: (state: AIChatSessionProjectState) => void;
}) {
  const { t } = useTranslation("aiPanel");
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesElRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showTokenCount] = Settings.use("aiShowTokenCount");
  const [showDebug] = Settings.use("showDebug");
  const [autoApproveMcpTools, setAutoApproveMcpTools] = Settings.use("aiAutoApproveMcpTools");
  const autoApproveMcpToolsId = useId();
  const [apiBaseUrl] = Settings.use("aiApiBaseUrl");
  const [apiKey] = Settings.use("aiApiKey");
  const [model] = Settings.use("aiModel");
  const [manualContextWindow] = Settings.use("aiContextWindow");
  const contextWindowTokenLimitRef = useRef<number | undefined>(undefined);
  const conversation = useMemo(
    () => project.aiEngine.createConversation(project, references, () => contextWindowTokenLimitRef.current),
    [project, references],
  );
  const [selection, setSelection] = useState({ nodes: 0, edges: 0 });
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [contextWindowState, setContextWindowState] = useState<ContextWindowState>({ status: "loading" });
  const projectUri = project.uri.toString();
  const messagesRef = useRef<UIMessage<AIMessageMetadata>[]>(session.messages);
  const lastSavedMessagesRef = useRef<UIMessage<AIMessageMetadata>[]>(session.messages);

  const persistMessages = useCallback(
    async (nextMessages: UIMessage<AIMessageMetadata>[]) => {
      await AIProjectReferenceStore.save(project, references.exportSnapshot());
      const nextState = await AIChatSessionStore.saveSession(projectUri, session.id, nextMessages);
      lastSavedMessagesRef.current = nextMessages;
      onSessionSaved(nextState);
    },
    [onSessionSaved, project, projectUri, references, session.id],
  );

  const { messages, setMessages, sendMessage, stop, status, addToolApprovalResponse } = useChat<
    UIMessage<AIMessageMetadata>
  >({
    id: session.id,
    transport: conversation.transport,
    experimental_throttle: 50,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (err) => {
      toast.error(`AI 请求失败: ${err.message || err.toString() || JSON.stringify(err)}`);
    },
  });
  const requesting = status === "submitted" || status === "streaming";
  const tokenUsage = useMemo(() => getTokenUsage(messages), [messages]);
  const contextUsage = useMemo(() => getCurrentContextUsage(messages), [messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useLayoutEffect(() => {
    const list = messagesElRef.current;
    if (list && followMessages.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function updateScrollPosition() {
    const list = messagesElRef.current;
    if (!list) return;
    followMessages.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    setShowJumpToLatest(!followMessages.current);
  }

  function jumpToLatest() {
    const list = messagesElRef.current;
    if (!list) return;
    followMessages.current = true;
    list.scrollTop = list.scrollHeight;
    setShowJumpToLatest(false);
  }

  useEffect(() => {
    let cancelled = false;
    contextWindowTokenLimitRef.current = undefined;
    setContextWindowState({ status: "loading" });
    resolveAIModelContextWindow({
      apiBaseUrl,
      apiKey,
      model,
      manualTokenLimit: manualContextWindow,
    })
      .then((info) => {
        if (cancelled) return;
        contextWindowTokenLimitRef.current = info?.tokenLimit;
        setContextWindowState(info ? { status: "ready", info } : { status: "unknown" });
      })
      .catch((contextWindowError) => {
        if (cancelled) return;
        contextWindowTokenLimitRef.current = undefined;
        setContextWindowState({
          status: "error",
          message: contextWindowError instanceof Error ? contextWindowError.message : String(contextWindowError),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiKey, manualContextWindow, model]);

  useEffect(() => {
    setMessages(session.messages);
    messagesRef.current = session.messages;
    lastSavedMessagesRef.current = session.messages;
    setSessionLoaded(true);
  }, [session.id, setMessages]);

  useEffect(() => {
    onRequestingChange(requesting);
    return () => onRequestingChange(false);
  }, [onRequestingChange, requesting]);

  useEffect(() => {
    onControllerChange({
      save: async () => {
        await persistMessages(messagesRef.current);
      },
    });
    return () => onControllerChange(null);
  }, [onControllerChange, persistMessages]);

  useEffect(() => {
    if (!sessionLoaded || requesting || messages === lastSavedMessagesRef.current) return;
    const timeout = window.setTimeout(() => {
      void persistMessages(messages).catch((saveError) => {
        toast.error(`AI 会话保存失败: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [messages, persistMessages, requesting, sessionLoaded]);

  useEffect(() => {
    const updateSelection = () => {
      const nodes = project.stageManager.getSelectedEntities().length;
      const edges = project.stageManager.getSelectedAssociations().length;
      setSelection((previous) => (previous.nodes === nodes && previous.edges === edges ? previous : { nodes, edges }));
    };
    updateSelection();
    const interval = setInterval(updateSelection, 300);
    return () => clearInterval(interval);
  }, [project]);

  useEffect(() => {
    if (pendingInitialText) {
      const text = pendingInitialText;
      const prompt = pendingInitialPrompt;
      pendingInitialText = null;
      pendingInitialPrompt = null;

      if (prompt) {
        setInputValue(`${prompt}\n\n---\n\n${text}`);
      } else {
        setInputValue(text);
      }
    }
  }, []);

  function handleUserSend() {
    const text = inputValue.trim();
    if (!text || requesting || !sessionLoaded) return;
    const selectedEntities = project.stageManager.getSelectedEntities();
    const selectedAssociations = project.stageManager.getSelectedAssociations();
    const selectedRefs = [...selectedEntities, ...selectedAssociations].map((object) =>
      references.getOrCreateRef(object),
    );
    const prefix = selectedRefs.length > 0 ? `[selected: ${selectedRefs.join(" ")}]\n` : "";
    const messageText = prefix + text;
    jumpToLatest();
    project.aiEngine.getRequestTraceBuffer().capturePendingInput(session.id, messageText);
    sendMessage({ text: messageText });
    setInputValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      handleUserSend();
    }
  }

  const ObjectRefCode = useCallback(
    ({ children, ...props }: any) => {
      const text = typeof children === "string" ? children : String(children ?? "");
      const stageObject = references.tryResolve(text);
      if (!stageObject || !isEntity(stageObject)) {
        return <code {...props}>{children}</code>;
      }

      const hasColor = "color" in stageObject && stageObject.color instanceof Color;
      const bgColor = hasColor ? (stageObject.color as Color).toHexStringWithoutAlpha() : undefined;
      const textColor = hasColor ? getContrastTextColor(stageObject.color as Color) : undefined;

      const hasText = "text" in stageObject && typeof stageObject.text === "string";
      const textPreview = hasText
        ? `${(stageObject.text as string).split("\n")[0]} `
        : `${getOriginalNameOf(stageObject.constructor)} ${text}`;

      const handleClick = () => {
        project.stageManager.clearSelectAll();
        stageObject.isSelected = true;
        const center = stageObject.collisionBox.getRectangle().center;
        project.camera.bombMove(center);
      };

      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="hover:ring-primary/50 inline-flex cursor-pointer items-center rounded px-1.5 py-0.5 text-xs transition-all hover:ring-2"
              style={bgColor ? { backgroundColor: bgColor, color: textColor } : undefined}
              onClick={handleClick}
            >
              {textPreview}
            </span>
          </TooltipTrigger>
          <TooltipContent>{text}</TooltipContent>
        </Tooltip>
      );
    },
    [project, references],
  );

  const markdownComponents = useMemo(() => ({ inlineCode: ObjectRefCode }), [ObjectRefCode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={messagesElRef}
          onScroll={updateScrollPosition}
          className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-9"
          role="region"
          aria-label={t("messages")}
        >
          {messages.length === 0 ? (
            <div className="mx-auto flex min-h-full max-w-72 flex-col items-center justify-center gap-4 py-4 text-center">
              <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-2xl">
                <Sparkles className="size-5" />
              </div>
              <h2 className="text-base font-semibold">{t("emptyTitle")}</h2>
              <div className="flex flex-wrap justify-center gap-2">
                {(["arrangeSelection", "reviewGraph"] as const).map((action) => (
                  <Button
                    key={action}
                    variant="outline"
                    size="sm"
                    disabled={!sessionLoaded || requesting || Boolean(inputValue.trim())}
                    onClick={() => {
                      setInputValue(t(`suggestions.${action}.prompt`));
                      inputRef.current?.focus();
                    }}
                  >
                    {t(`suggestions.${action}.label`)}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-5">
              {messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  components={markdownComponents}
                  project={project}
                  selectedCount={selection.nodes}
                  isStreaming={requesting && index === messages.length - 1}
                  onToolApproval={async (id, approved) => {
                    await addToolApprovalResponse({ id, approved });
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {showJumpToLatest && (
          <Button size="sm" variant="outline" className="absolute right-4 bottom-2" onClick={jumpToLatest}>
            <ArrowDown data-icon="inline-start" />
            {t("latestMessage")}
          </Button>
        )}
      </div>

      <div className="border-border/70 bg-card shrink-0 border-t px-4 pt-3 pb-3">
        <div className="border-input bg-background focus-within:border-ring rounded-xl border shadow-xs">
          <Textarea
            ref={inputRef}
            aria-label={t("messageInput")}
            placeholder={t("placeholder")}
            className="max-h-36 min-h-16 resize-none border-0 px-3 shadow-none focus-visible:ring-0"
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            value={inputValue}
            disabled={requesting || !sessionLoaded}
          />
          <div className="flex min-h-11 items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-2 pl-1">
              {selection.nodes + selection.edges > 0 && (
                <Badge variant="secondary" className="min-w-0">
                  <Paperclip data-icon="inline-start" />
                  <span className="truncate">
                    {t("selection", {
                      items: [
                        selection.nodes && t("selectedNodes", { count: selection.nodes }),
                        selection.edges && t("selectedEdges", { count: selection.edges }),
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    })}
                  </span>
                </Badge>
              )}
              {requesting && (
                <span className="text-muted-foreground shrink-0 text-xs" role="status">
                  {t("generating")}
                </span>
              )}
              {!requesting && selection.nodes + selection.edges === 0 && (
                <span className="text-muted-foreground text-xs">{t("newlineShortcut")}</span>
              )}
            </div>
            {requesting ? (
              <Button size="sm" variant="outline" onClick={stop}>
                <Square data-icon="inline-start" />
                {t("stop")}
              </Button>
            ) : (
              <Button size="sm" onClick={handleUserSend} disabled={!sessionLoaded || !inputValue.trim()}>
                <Send data-icon="inline-start" />
                {t("send")}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Switch
            id={autoApproveMcpToolsId}
            checked={autoApproveMcpTools}
            disabled={requesting || !sessionLoaded}
            onCheckedChange={setAutoApproveMcpTools}
            aria-label="自动批准 MCP 工具"
          />
          <label htmlFor={autoApproveMcpToolsId} className="flex cursor-pointer items-center gap-1.5 text-xs">
            自动批准 MCP 工具
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground cursor-help text-xs underline decoration-dotted underline-offset-2"
              >
                安全说明
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              开启后 MCP 工具无需逐次批准；本地 stdio 进程首次启动仍需单独确认。设置从下一次请求开始生效。
            </TooltipContent>
          </Tooltip>
          {showTokenCount && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs tabular-nums"
                  aria-label={t("tokenUsage", {
                    input: formatTokenCount(tokenUsage.inputTokens),
                    output: formatTokenCount(tokenUsage.outputTokens),
                  })}
                >
                  <User className="size-3.5" />
                  {formatTokenCount(tokenUsage.inputTokens)}
                  <Bot className="ml-1 size-3.5" />
                  {formatTokenCount(tokenUsage.outputTokens)}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("tokenUsageHint")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <ContextWindowUsage
          usage={contextUsage}
          state={contextWindowState}
          sessionTotalTokens={tokenUsage.totalTokens}
        />
        {showDebug && (
          <AIRequestTraceView buffer={project.aiEngine.getRequestTraceBuffer()} activeSessionId={session.id} />
        )}
      </div>
    </div>
  );
}

function getTokenUsage(messages: UIMessage<AIMessageMetadata>[]) {
  return messages.reduce(
    (usage, message) => {
      usage.inputTokens += message.metadata?.inputTokens ?? 0;
      usage.outputTokens += message.metadata?.outputTokens ?? 0;
      usage.totalTokens += message.metadata?.totalTokens ?? 0;
      return usage;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

function formatTokenCount(value: number) {
  return value.toLocaleString();
}

type CurrentContextUsage = {
  inputTokens: number;
  outputTokens: number;
  usedTokens: number;
};

function getCurrentContextUsage(messages: UIMessage<AIMessageMetadata>[]): CurrentContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const metadata = messages[index].metadata;
    if (typeof metadata?.lastStepInputTokens !== "number") continue;
    const outputTokens = metadata.lastStepOutputTokens ?? 0;
    return {
      inputTokens: metadata.lastStepInputTokens,
      outputTokens,
      usedTokens: metadata.lastStepInputTokens + outputTokens,
    };
  }
  return null;
}

function formatCompactTokenCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ContextWindowUsage({
  usage,
  state,
  sessionTotalTokens,
}: {
  usage: CurrentContextUsage | null;
  state: ContextWindowState;
  sessionTotalTokens: number;
}) {
  const tokenLimit = state.status === "ready" ? state.info.tokenLimit : undefined;
  const percentage = tokenLimit && usage ? Math.min(100, (usage.usedTokens / tokenLimit) * 100) : 0;
  const indicatorVariant = percentage >= 90 ? "destructive" : percentage >= 70 ? "caution" : "default";
  const usedText = usage ? formatCompactTokenCount(usage.usedTokens) : "--";
  const summary =
    state.status === "loading"
      ? `${usedText} / 正在获取上限`
      : state.status === "ready"
        ? `${usedText} / ${formatCompactTokenCount(state.info.tokenLimit)} · ${usage ? `${((usage.usedTokens / state.info.tokenLimit) * 100).toFixed(1)}%` : "--"}`
        : state.status === "error"
          ? `${usedText} / 获取失败`
          : `${usedText} / 上限未知`;
  const source = state.status === "ready" ? (state.info.source === "openrouter" ? "OpenRouter" : "手动设置") : "未知";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="mt-2 flex flex-col gap-1 outline-none"
          tabIndex={0}
          role="status"
          aria-label={`上下文窗口 ${summary}`}
        >
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>上下文</span>
            <span>{summary}</span>
          </div>
          <Progress
            value={percentage}
            indicatorVariant={indicatorVariant}
            className="h-1"
            aria-label="上下文窗口使用率"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex min-w-56 flex-col gap-1">
          <div>占用量按最后一步模型输入与输出计算</div>
          <div>最后输入：{usage ? formatTokenCount(usage.inputTokens) : "暂无"}</div>
          <div>最后输出：{usage ? formatTokenCount(usage.outputTokens) : "暂无"}</div>
          <div>会话累计计费：{formatTokenCount(sessionTotalTokens)}</div>
          <div>上下文上限来源：{source}</div>
          {state.status === "error" && <div>错误：{state.message}</div>}
          {state.status === "unknown" && <div>可在 AI 设置中手动填写上下文窗口大小</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

type ChatMessage = UIMessage<AIMessageMetadata> & { content?: string };
type ChatPart = ChatMessage["parts"][number];
type ChatToolPart = Extract<ChatPart, { toolCallId: string }>;
type ToolApprovalHandler = (id: string, approved: boolean) => Promise<void>;

function isChatToolPart(part: ChatPart): part is ChatToolPart {
  return isAIToolPart(part);
}

export function MessageBubble({
  message,
  components,
  project,
  selectedCount,
  isStreaming,
  onToolApproval,
}: {
  message: ChatMessage;
  components?: Record<string, React.ComponentType<any>>;
  project: Project;
  selectedCount: number;
  isStreaming: boolean;
  onToolApproval: ToolApprovalHandler;
}) {
  const { t } = useTranslation("aiPanel");
  const isUser = message.role === "user";
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const texts = parts.filter((part) => part.type === "text").map((part) => part.text);
  if (!texts.length && message.content) texts.push(String(message.content));
  const activity = parts.filter((part) => part.type !== "text" && part.type !== "step-start");
  const pendingTools = activity.filter(isChatToolPart).filter((part) => part.state === "approval-requested");
  const recordedActivity = activity.filter((part) => !isChatToolPart(part) || part.state !== "approval-requested");
  const responseText = texts.join("\n");
  const longResponse = !isUser && (responseText.length > 1000 || responseText.split("\n").length > 12);
  const body = texts.map((text, index) => (
    <Streamdown
      key={index}
      className="pg-ai-markdown min-w-0"
      plugins={{ code }}
      components={components}
      animated={!isUser && isStreaming}
      isAnimating={!isUser && isStreaming}
      caret={!isUser && isStreaming && index === texts.length - 1 && !pendingTools.length ? "circle" : undefined}
    >
      {text}
    </Streamdown>
  ));

  if (!responseText && !activity.length) return null;

  return (
    <article
      className={cn("flex items-start gap-2", isUser && "justify-end")}
      aria-label={t(isUser ? "user" : "assistant")}
    >
      {!isUser && (
        <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
          <Bot className="size-4" />
        </span>
      )}
      <div className={cn("flex min-w-0 flex-col items-start gap-2", isUser ? "max-w-[88%] items-end" : "flex-1")}>
        {recordedActivity.length > 0 && <MessageActivity parts={recordedActivity} isStreaming={isStreaming} />}
        {longResponse ? (
          <Collapsible className="group/response border-border bg-card w-full rounded-xl border">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                {t(isStreaming ? "generatingDetail" : "viewDetail")}
                <ChevronRight data-icon="inline-end" className="group-data-[state=open]/response:rotate-90" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent animate={false}>
              <div className="border-border max-h-[min(55vh,28rem)] overflow-auto overscroll-contain border-t px-3 py-2 text-sm leading-relaxed select-text">
                {body}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          responseText && (
            <div
              className={cn(
                "max-w-full min-w-0 cursor-text text-sm leading-relaxed select-text",
                isUser && "bg-accent text-accent-foreground rounded-2xl rounded-tr-sm px-3 py-2",
                !isUser && "pt-1",
              )}
            >
              {body}
            </div>
          )
        )}
        {pendingTools.map((part) => (
          <ToolApprovalPart
            key={part.toolCallId}
            name={getAIToolPartName(part)}
            approvalId={part.approval.id}
            input={part.input}
            onToolApproval={onToolApproval}
          />
        ))}
        {!isUser && selectedCount === 1 && responseText.trim() && !isStreaming && !pendingTools.length && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => createAnswerNode(responseText.trim(), project)}
          >
            <Plus data-icon="inline-start" />
            {t("addToCanvas")}
          </Button>
        )}
      </div>
    </article>
  );
}

function MessageActivity({ parts, isStreaming }: { parts: ChatPart[]; isStreaming: boolean }) {
  const { t } = useTranslation("aiPanel");
  const toolParts = parts.filter(isChatToolPart);
  const failedCount = toolParts.filter((part) => part.state === "output-error").length;
  return (
    <Collapsible className="group/activity bg-muted/40 border-border/70 w-full rounded-xl border">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start text-xs">
          <Sparkles data-icon="inline-start" />
          {t(isStreaming ? "activityInProgress" : "activity")}
          <span className="ml-auto truncate font-normal">
            {toolParts.length > 0 && t("toolCalls", { count: toolParts.length })}
            {failedCount > 0 && (
              <span className="text-destructive"> · {t("toolFailures", { count: failedCount })}</span>
            )}
          </span>
          <ChevronRight data-icon="inline-end" className="group-data-[state=open]/activity:rotate-90" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent animate={false}>
        <div className="border-border/70 flex max-h-64 flex-col gap-2 overflow-auto overscroll-contain border-t p-2">
          {parts.map((part, index) => {
            if (isChatToolPart(part)) return <ToolPart key={part.toolCallId} part={part} />;
            if (part.type === "reasoning") {
              return (
                <div
                  key={index}
                  className="text-muted-foreground px-2 py-1 text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap select-text"
                >
                  {part.text ?? ("reasoning" in part ? String(part.reasoning ?? "") : "")}
                </div>
              );
            }
            return (
              <pre key={index} className="overflow-auto text-xs">
                {JSON.stringify(part, null, 2)}
              </pre>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolPart({ part }: { part: ChatToolPart }) {
  const { t } = useTranslation("aiPanel");
  const name = getAIToolPartName(part);
  const done = part.state === "output-available";
  const failed = part.state === "output-error";

  return (
    <Collapsible className="group/tool bg-background/70 min-w-0 shrink-0 rounded-lg">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start text-xs" title={name}>
          <ChevronRight data-icon="inline-start" className="group-data-[state=open]/tool:rotate-90" />
          <span className="truncate font-mono">{name}</span>
          <span className={cn("ml-auto font-normal", failed && "text-destructive")}>
            {t(`toolStates.${part.state}`, { defaultValue: part.state })}
          </span>
          {done && <Check aria-hidden="true" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent animate={false} className="px-2 pb-2">
        <Streamdown className="pg-ai-markdown" plugins={{ code }}>
          {`\`\`\`json\n${JSON.stringify({ input: part.input, output: part.output, error: part.errorText }, null, 2)}\n\`\`\``}
        </Streamdown>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolApprovalPart({
  name,
  approvalId,
  input,
  onToolApproval,
}: {
  name: string;
  approvalId: string;
  input: unknown;
  onToolApproval: ToolApprovalHandler;
}) {
  const { t } = useTranslation("aiPanel");
  const [submitting, setSubmitting] = useState(false);
  const respond = async (approved: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onToolApproval(approvalId, approved);
    } catch (error) {
      toast.error(t("approvalError", { message: error instanceof Error ? error.message : String(error) }));
      setSubmitting(false);
    }
  };

  return (
    <div className="border-border bg-card flex w-full min-w-0 flex-col gap-2 rounded-xl border p-3">
      <div className="text-xs font-medium">{t("approvalRequired")}</div>
      <div className="text-muted-foreground font-mono text-xs wrap-anywhere">{name}</div>
      <pre className="bg-muted max-h-48 overflow-auto rounded-md p-2 font-mono text-xs select-text">
        {JSON.stringify(input, null, 2)}
      </pre>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          className="h-7 px-2"
          variant="outline"
          disabled={submitting}
          onClick={() => void respond(false)}
        >
          {t("deny")}
        </Button>
        <Button size="sm" className="h-7 px-2" disabled={submitting} onClick={() => void respond(true)}>
          {t("allowOnce")}
        </Button>
      </div>
    </div>
  );
}

AIWindow.open = () => {
  createSubWindow("AIWindow", {
    title: "",
    contextTarget: "activeResourceTab",
    closable: false,
    titleBarOverlay: true,
    closeOnEscape: false,
    children: (tab) => <AIWindow tabId={tab.id} />,
    rect: new Rectangle(new Vector(8, 88), new Vector(380, window.innerHeight - 96)),
  });
};
