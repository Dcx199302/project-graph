import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  historyManagerMode: "memoryEfficient",
  historySize: 100,
  showDebug: false,
  unwatch: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("@/core/Project", () => ({
  Project: class Project {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: (id: string) => (target: { id?: string }) => {
    target.id = id;
    return target;
  },
}));
vi.mock("@/core/service/Settings", () => ({ Settings: settings }));

import { HistoryManager } from "./StageHistoryManager";

describe("HistoryManager cleanup", () => {
  beforeEach(() => {
    settings.unwatch.mockReset();
    settings.watch.mockReset().mockImplementation((_key, callback) => {
      callback("memoryEfficient");
      return settings.unwatch;
    });
  });

  it("unsubscribes from Settings when the acquired service is disposed", () => {
    const manager = new HistoryManager({ stage: [], emit: vi.fn(), projectState: "saved" } as never);
    const dispose = (manager as unknown as { dispose?: () => void }).dispose;

    expect(dispose).toBeTypeOf("function");
    dispose?.call(manager);
    expect(settings.unwatch).toHaveBeenCalledOnce();
  });
});

describe.each(["memoryEfficient", "timeEfficient"])("HistoryManager (%s)", (mode) => {
  beforeEach(() => {
    settings.historyManagerMode = mode;
    settings.historySize = 100;
    settings.watch.mockReset().mockReturnValue(settings.unwatch);
  });

  function createHistory() {
    const project = {
      stage: [{ text: "initial" }],
      emit: vi.fn(),
      projectState: "saved",
      stageManager: { updateReferences: vi.fn() },
    };
    const history = new HistoryManager(project as never);
    return { project, history };
  }

  it("records the final state of a nested batch and keeps the next action separate", () => {
    const { project, history } = createHistory();
    history.batch(() => {
      project.stage[0].text = "intermediate";
      history.recordStep();
      history.batch(() => {
        project.stage.push({ text: "new node" });
        history.recordStep();
      });
      project.stage[0].text = "first action";
      expect(project.emit).not.toHaveBeenCalled();
    });
    history.batch(() => {
      project.stage[0].text = "second action";
      history.recordStep();
    });

    expect(project.emit.mock.calls).toEqual([["stage-commit"], ["stage-commit"]]);
    history.undo();
    expect(project.stage).toEqual([{ text: "first action" }, { text: "new node" }]);
    history.undo();
    expect(project.stage).toEqual([{ text: "initial" }]);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(project.stage).toEqual([{ text: "first action" }, { text: "new node" }]);
    history.redo();
    expect(project.stage).toEqual([{ text: "second action" }, { text: "new node" }]);
    expect(history.canRedo).toBe(false);
  });

  it("ignores unchanged records and only replaces redo after a new change", () => {
    const { project, history } = createHistory();
    history.recordStep();
    expect(history.canUndo).toBe(false);
    expect(project.projectState).toBe("saved");
    expect(project.emit).not.toHaveBeenCalled();

    project.stage[0].text = "first edit";
    history.recordStep();
    history.undo();
    history.batch(() => {
      history.recordStep();
      history.recordStep();
    });
    expect(history.canRedo).toBe(true);
    expect(project.emit).toHaveBeenCalledOnce();

    project.stage[0].text = "replacement edit";
    history.recordStep();
    expect(history.canRedo).toBe(false);
    history.undo();
    history.redo();
    expect(project.stage).toEqual([{ text: "replacement edit" }]);
  });

  it("undoes only to the state preceding the oldest retained step", () => {
    settings.historySize = 2;
    const { project, history } = createHistory();
    for (const text of ["first", "second", "third"]) {
      project.stage[0].text = text;
      history.recordStep();
    }
    history.undo();
    history.undo();
    expect(project.stage).toEqual([{ text: "first" }]);
    expect(history.canUndo).toBe(false);
  });
});
