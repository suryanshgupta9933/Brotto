/**
 * Jest setup file for browser extension tests
 */

// Mock chrome API globally
const mockChrome = {
  runtime: {
    lastError: null,
    id: "brotto-browser-extension",
    getManifest: () => ({ version: "1.0.0" }),
    sendMessage: jest.fn((message, callback) => {
      if (callback) callback({ success: true });
    }),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve())
    }
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([])),
    get: jest.fn(() => Promise.resolve({ id: 1, title: "Test", url: "https://example.com" })),
    create: jest.fn(() => Promise.resolve({ id: 1 })),
    remove: jest.fn(() => Promise.resolve())
  },
  tabGroups: {
    query: jest.fn(() => Promise.resolve([]))
  },
  debugger: {
    attach: jest.fn((target, version, callback) => {
      if (callback) callback();
    }),
    detach: jest.fn((target, callback) => {
      if (callback) callback();
    }),
    sendCommand: jest.fn((target, method, params, callback) => {
      if (callback) callback({ success: true });
    }),
    getTargets: jest.fn((callback) => {
      if (callback) callback([]);
    }),
    onEvent: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onDetach: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
    setTitle: jest.fn()
  },
  notifications: {
    create: jest.fn((id, options, callback) => {
      if (callback) callback(id);
    }),
    clear: jest.fn()
  },
  windows: {
    getCurrent: jest.fn((callback) => {
      if (callback) callback({ id: 1 });
    })
  }
};

// Make chrome available globally
(global as unknown as Record<string, unknown>).chrome = mockChrome;

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("")
  })
) as jest.Mock;

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code: code || 1000, reason: reason || "" }));
    }
  }
}

(global as unknown as Record<string, unknown>).WebSocket = MockWebSocket as unknown as typeof WebSocket;

// Silence console noise during tests
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});
