import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  class FakeKeyboardEvent {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init });
    }
  }
  vi.stubGlobal("KeyboardEvent", FakeKeyboardEvent);
  vi.stubGlobal("MouseEvent", class {});
  vi.stubGlobal("WheelEvent", class {});
});

import { matchSingleEmacsKey } from "./emacs";

const key = (init: Record<string, unknown>) => new (KeyboardEvent as any)(init) as KeyboardEvent;
const cas = { ctrlKey: true, altKey: true, shiftKey: true };

describe("matchSingleEmacsKey", () => {
  it("Shift+减号（event.key 为 _）可以匹配 C-A-S--", () => {
    expect(matchSingleEmacsKey("C-A-S--", key({ ...cas, key: "_", code: "Minus" }))).toBe(true);
  });
  it("Shift+等号可以匹配 C-A-S-+", () => {
    expect(matchSingleEmacsKey("C-A-S-+", key({ ...cas, key: "+", code: "Equal" }))).toBe(true);
    expect(matchSingleEmacsKey("C-A-S-+", key({ ...cas, key: "Unidentified", code: "Equal" }))).toBe(true);
  });
  it("不按 Shift 时不走物理按键回退，C-= 不会误触 C-+", () => {
    expect(matchSingleEmacsKey("C-+", key({ ctrlKey: true, key: "=", code: "Equal" }))).toBe(false);
    expect(matchSingleEmacsKey("C-=", key({ ctrlKey: true, key: "=", code: "Equal" }))).toBe(true);
  });
  it.each([
    { key: "+", code: "Equal", shiftKey: true },
    { key: "+", code: "NumpadAdd" },
  ])("等号快捷键兼容 $code 上的加号，并区分 Command", (init) => {
    expect(matchSingleEmacsKey("=", key(init))).toBe(true);
    expect(matchSingleEmacsKey("M-=", key(init))).toBe(false);
    const withCommand = key({ ...init, metaKey: true });
    expect(matchSingleEmacsKey("=", withCommand)).toBe(false);
    expect(matchSingleEmacsKey("M-=", withCommand)).toBe(true);
  });
  it("C-A-S-+ 与 C-A-S-- 互不误触", () => {
    expect(matchSingleEmacsKey("C-A-S--", key({ ...cas, key: "+", code: "Equal" }))).toBe(false);
    expect(matchSingleEmacsKey("C-A-S-+", key({ ...cas, key: "_", code: "Minus" }))).toBe(false);
  });
});
