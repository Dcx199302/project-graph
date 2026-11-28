// @vitest-environment jsdom

import { isWindowAlwaysOnTopAtom, store } from "@/state";
import { Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import RightToolbar from "./right-toolbar";

const platform = vi.hoisted(() => ({ isWeb: false, setAlwaysOnTop: vi.fn(async () => {}) }));
vi.mock("@/utils/platform", () => ({
  get isWeb() {
    return platform.isWeb;
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setAlwaysOnTop: platform.setAlwaysOnTop }) }));
vi.mock("@/core/Tab", () => ({ isResourceTab: () => false }));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/service/QuickSettingsManager", () => ({ QuickSettingsManager: { getQuickSettings: async () => [] } }));
vi.mock("@/core/service/SettingsIcons", () => ({ settingsIcons: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it.each([false, true])("shows a working always-on-top switch on the desktop only (web=%s)", async (isWeb) => {
  platform.isWeb = isWeb;
  platform.setAlwaysOnTop.mockClear();
  store.set(isWindowAlwaysOnTopAtom, false);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <Provider store={store}>
          <RightToolbar />
        </Provider>,
      ),
    );
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const pin = toolbar.querySelector<HTMLButtonElement>('[role="switch"][aria-label="alwaysOnTop"]');
    if (isWeb) {
      expect(pin).toBeNull();
      expect(platform.setAlwaysOnTop).not.toHaveBeenCalled();
      return;
    }
    const icon = toolbar.querySelector<HTMLButtonElement>('button[aria-pressed][aria-label="alwaysOnTop"]')!;
    expect(icon.querySelector(".lucide-pin")).not.toBeNull();
    expect(icon.parentElement).toBe(pin?.parentElement?.parentElement);
    expect(pin?.parentElement?.classList.contains("w-0")).toBe(true);
    await act(async () => toolbar.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(pin?.parentElement?.classList.contains("w-10")).toBe(true);
    expect(pin?.getAttribute("aria-checked")).toBe("false");
    await act(async () => pin!.click());
    expect(pin?.getAttribute("aria-checked")).toBe("true");
    expect(icon.getAttribute("aria-pressed")).toBe("true");
    await act(async () => icon.click());
    expect(pin?.getAttribute("aria-checked")).toBe("false");
    expect(platform.setAlwaysOnTop.mock.calls).toEqual([[true], [false]]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
