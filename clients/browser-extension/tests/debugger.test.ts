/**
 * Unit tests for chrome.debugger wrapper
 */

// Mock chrome.debugger
const mockAttachedTabs = new Set<number>();
const mockEventListeners = new Map<string, ((...args: unknown[]) => void)[]>();

global.chrome = {
  debugger: {
    attach: (
      target: chrome.debugger.Debuggee,
      requiredVersion: string,
      callback?: () => void
    ) => {
      if (target.tabId) {
        mockAttachedTabs.add(target.tabId);
      }
      callback?.();
    },
    detach: (target: chrome.debugger.Debuggee, callback?: () => void) => {
      if (target.tabId) {
        mockAttachedTabs.delete(target.tabId);
      }
      callback?.();
    },
    sendCommand: (
      target: chrome.debugger.Debuggee,
      method: string,
      params?: Record<string, unknown>,
      callback?: (result: unknown, error?: string) => void
    ) => {
      callback?.({ success: true }, undefined);
    },
    getTargets: (callback: (targets: chrome.debugger.Target[]) => void) => {
      callback([
        {
          id: "target1",
          type: "page",
          title: "Test Page",
          url: "https://example.com",
          attached: false,
          tabId: 1
        }
      ]);
    },
    onEvent: {
      addListener: (listener: (...args: unknown[]) => void) => {
        const key = "onEvent";
        const listeners = mockEventListeners.get(key) || [];
        listeners.push(listener);
        mockEventListeners.set(key, listeners);
      },
      removeListener: (listener: (...args: unknown[]) => void) => {
        const key = "onEvent";
        const listeners = mockEventListeners.get(key) || [];
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    },
    onDetach: {
      addListener: (listener: (...args: unknown[]) => void) => {
        const key = "onDetach";
        const listeners = mockEventListeners.get(key) || [];
        listeners.push(listener);
        mockEventListeners.set(key, listeners);
      },
      removeListener: (listener: (...args: unknown[]) => void) => {
        const key = "onDetach";
        const listeners = mockEventListeners.get(key) || [];
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }
  },
  tabs: {
    get: async (tabId: number) => ({
      id: tabId,
      title: "Test Tab",
      url: "https://example.com",
      favIconUrl: "https://example.com/favicon.ico",
      incognito: false,
      windowId: 1
    })
  }
} as unknown as typeof chrome;

import {
  attachToTab,
  detachFromTab,
  detachAll,
  sendCommand,
  isAttached,
  getActiveSessions,
  checkTabSecurity,
  getTabInfo,
  registerEventHandler,
  unregisterEventHandlers
} from "../src/debugger";

describe("chrome.debugger Wrapper", () => {
  beforeEach(() => {
    mockAttachedTabs.clear();
  });

  describe("attachToTab", () => {
    it("should attach debugger to a tab", async () => {
      const session = await attachToTab(123);

      expect(session).toBeDefined();
      expect(session.tabId).toBe(123);
      expect(session.sessionId).toBeDefined();
      expect(isAttached(123)).toBe(true);
    });

    it("should create unique session IDs", async () => {
      const session1 = await attachToTab(1);
      const session2 = await attachToTab(2);

      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });

  describe("detachFromTab", () => {
    it("should detach debugger from a tab", async () => {
      await attachToTab(123);
      expect(isAttached(123)).toBe(true);

      await detachFromTab(123);
      expect(isAttached(123)).toBe(false);
    });

    it("should handle detach from non-attached tab", async () => {
      // Should not throw
      await detachFromTab(999);
      expect(isAttached(999)).toBe(false);
    });
  });

  describe("detachAll", () => {
    it("should detach from all attached tabs", async () => {
      await attachToTab(1);
      await attachToTab(2);
      await attachToTab(3);

      expect(isAttached(1)).toBe(true);
      expect(isAttached(2)).toBe(true);
      expect(isAttached(3)).toBe(true);

      await detachAll();

      expect(isAttached(1)).toBe(false);
      expect(isAttached(2)).toBe(false);
      expect(isAttached(3)).toBe(false);
    });
  });

  describe("sendCommand", () => {
    it("should send CDP command to attached tab", async () => {
      await attachToTab(123);

      const result = await sendCommand(123, {
        method: "Page.enable"
      });

      expect(result).toEqual({ success: true });
    });

    it("should include params in command", async () => {
      await attachToTab(123);

      const result = await sendCommand(123, {
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: 100, y: 200 }
      });

      expect(result).toEqual({ success: true });
    });
  });

  describe("isAttached", () => {
    it("should return true for attached tabs", async () => {
      await attachToTab(123);
      expect(isAttached(123)).toBe(true);
    });

    it("should return false for non-attached tabs", () => {
      expect(isAttached(999)).toBe(false);
    });
  });

  describe("getActiveSessions", () => {
    it("should return all active sessions", async () => {
      const session1 = await attachToTab(1);
      const session2 = await attachToTab(2);

      const sessions = getActiveSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.tabId)).toContain(1);
      expect(sessions.map((s) => s.tabId)).toContain(2);
    });
  });

  describe("checkTabSecurity", () => {
    it("should flag sensitive URLs", async () => {
      // Mock tab with sensitive URL
      (chrome.tabs.get as jest.Mock).mockResolvedValueOnce({
        id: 123,
        title: "Gmail",
        url: "https://mail.google.com",
        incognito: false
      });

      const result = await checkTabSecurity(123);

      expect(result.isSecure).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes("sensitive"))).toBe(true);
    });

    it("should flag non-HTTPS URLs", async () => {
      (chrome.tabs.get as jest.Mock).mockResolvedValueOnce({
        id: 123,
        title: "Test",
        url: "http://example.com",
        incognito: false
      });

      const result = await checkTabSecurity(123);

      expect(result.isSecure).toBe(false);
      expect(result.warnings.some((w: string) => w.includes("HTTPS"))).toBe(true);
    });

    it("should flag incognito tabs", async () => {
      (chrome.tabs.get as jest.Mock).mockResolvedValueOnce({
        id: 123,
        title: "Test",
        url: "https://example.com",
        incognito: true
      });

      const result = await checkTabSecurity(123);

      expect(result.warnings.some((w: string) => w.includes("incognito"))).toBe(true);
    });

    it("should consider HTTPS URLs secure", async () => {
      (chrome.tabs.get as jest.Mock).mockResolvedValueOnce({
        id: 123,
        title: "Test",
        url: "https://example.com",
        incognito: false
      });

      const result = await checkTabSecurity(123);

      expect(result.isSecure).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("getTabInfo", () => {
    it("should return tab information", async () => {
      const info = await getTabInfo(123);

      expect(info).toBeDefined();
      expect(info?.id).toBe(123);
      expect(info?.title).toBe("Test Tab");
      expect(info?.url).toBe("https://example.com");
      expect(info?.favIconUrl).toBe("https://example.com/favicon.ico");
      expect(info?.incognito).toBe(false);
    });

    it("should return null for non-existent tab", async () => {
      (chrome.tabs.get as jest.Mock).mockRejectedValueOnce(new Error("Tab not found"));

      const info = await getTabInfo(999);
      expect(info).toBeNull();
    });
  });

  describe("event handlers", () => {
    it("should register and unregister event handlers", () => {
      const handler = jest.fn();

      registerEventHandler(123, handler);
      expect(mockEventListeners.has("onEvent")).toBe(true);

      unregisterEventHandlers(123);
      expect(mockEventListeners.get("onEvent")?.length).toBe(0);
    });
  });
});
