/**
 * Per-Session MCP Worker
 * Each browser session gets its own isolated MCP worker/process
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { SessionConfig } from './types.js';
import { FaraActionAdapter, createFaraActionAdapter, createAccessibilityVerifier } from './adapter.js';

/**
 * Cookie structure for session persistence
 */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/**
 * Worker interface for managing an isolated MCP session
 */
export interface MCPWorker {
  sessionId: string;
  adapter: FaraActionAdapter;
  verifier: ReturnType<typeof createAccessibilityVerifier>;
  initialize(): Promise<void>;
  terminate(): Promise<void>;
  isHealthy(): boolean;
  setCookies(cookies: SessionCookie[]): Promise<void>;
  getCookies(): SessionCookie[];
}

/**
 * Options for creating a worker
 */
export interface WorkerOptions {
  cdpEndpoint: string;
  viewportWidth: number;
  viewportHeight: number;
  browserType?: 'chromium' | 'firefox' | 'webkit';
  visionEnabled?: boolean;
}

/**
 * Mock MCP client for testing and development
 * In production, this would be replaced with actual Playwright MCP client
 */
export class MockMCPClient {
  private tools: Map<string, { description?: string }> = new Map();
  private cookies: SessionCookie[] = [];

  constructor() {
    // Register standard tools
    this.tools.set('browser_mouse_click_xy', { description: 'Click at coordinates' });
    this.tools.set('browser_mouse_drag_xy', { description: 'Drag from one point to another' });
    this.tools.set('browser_mouse_move_xy', { description: 'Move mouse to coordinates' });
    this.tools.set('browser_mouse_wheel', { description: 'Scroll the page' });
    this.tools.set('browser_press_key', { description: 'Press a keyboard key' });
    this.tools.set('browser_navigate', { description: 'Navigate to a URL' });
    this.tools.set('browser_navigate_back', { description: 'Go back in browser history' });
    this.tools.set('browser_take_screenshot', { description: 'Take a screenshot' });
    this.tools.set('browser_keyboard_insert_text', { description: 'Insert text at focused element' });
    this.tools.set('browser_take_accessibility_snapshot', { description: 'Get accessibility snapshot' });
    this.tools.set('browser_get_current_url', { description: 'Get current page URL' });
    this.tools.set('browser_list_tabs', { description: 'List open tabs' });
    // Disabled unsafe tools
    this.tools.set('browser_run_code_unsafe', { description: 'UNSAFE - disabled' });
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    return Array.from(this.tools.entries()).map(([name, info]) => ({
      name,
      description: info.description,
    }));
  }

  async callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{ content: Array<{ type: string; text: string }> }> {
    // Simulate tool execution
    return {
      content: [{ type: 'text', text: `Executed ${input.name} with ${JSON.stringify(input.arguments)}` }],
    };
  }
}

/**
 * Playwright MCP Worker implementation
 * Manages an isolated MCP connection for a single browser session
 */
export class PlaywrightMCPWorker implements MCPWorker {
  public readonly sessionId: string;
  public readonly adapter: FaraActionAdapter;
  public readonly verifier: ReturnType<typeof createAccessibilityVerifier>;
  public readonly cdpEndpoint: string;
  public readonly viewportWidth: number;
  public readonly viewportHeight: number;
  public readonly browserType: 'chromium' | 'firefox' | 'webkit';
  public readonly visionEnabled: boolean;

  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private healthy = false;
  private initPromise: Promise<void> | null = null;
  private cookies: SessionCookie[] = [];

  constructor(sessionId: string, options: WorkerOptions) {
    this.sessionId = sessionId;
    this.cdpEndpoint = options.cdpEndpoint;
    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.browserType = options.browserType ?? 'chromium';
    this.visionEnabled = options.visionEnabled ?? true;

    // Create mock client for now - will be replaced with actual Playwright MCP
    const mockClient = new MockMCPClient();
    this.adapter = createFaraActionAdapter(mockClient, sessionId);
    this.verifier = createAccessibilityVerifier(mockClient);
  }

  /**
   * Initialize the MCP worker and connect to Playwright MCP
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initializeInternal();
    return this.initPromise;
  }

  private async _initializeInternal(): Promise<void> {
    try {
      // Connect to Playwright MCP server using stdio transport
      // The CDP endpoint tells Playwright which browser to connect to
      const cdpUrl = new URL(this.cdpEndpoint);
      const playwrightArgs = [
        '-y',
        '@playwright/mcp@latest',
        '--',
        '--browser',
        this.browserType,
      ];

      const chromiumPath = this.browserType === 'chromium' && !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? '/usr/bin/chromium-browser'
        : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

      this.transport = new StdioClientTransport({
        command: 'npx',
        args: playwrightArgs,
        env: {
          ...process.env,
          // Playwright MCP configuration via environment
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '',
          PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: chromiumPath ?? '',
          // Pass viewport configuration
          VIEWPORT_WIDTH: String(this.viewportWidth),
          VIEWPORT_HEIGHT: String(this.viewportHeight),
          // Vision mode for screenshots
          PLAYWRIGHT_VISION_ENABLED: String(this.visionEnabled),
        },
      });

      this.client = new Client({
        name: 'fara-browser-gateway',
        version: '0.1.0',
      });

      // Connect with timeout
      await Promise.race([
        this.client.connect(this.transport),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('MCP connection timeout')), 30000)
        ),
      ]);

      this.healthy = true;
      console.log(`[MCPWorker] Connected to Playwright MCP for session ${this.sessionId}`);
    } catch (error) {
      this.healthy = false;
      throw new Error(`Failed to initialize MCP worker: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Terminate the MCP worker and cleanup
   */
  async terminate(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        this.transport = null;
      }
      this.healthy = false;
    } catch (error) {
      console.error(`Error terminating worker ${this.sessionId}:`, error);
      // Force cleanup regardless
      this.client = null;
      this.transport = null;
      this.healthy = false;
    }
  }

  /**
   * Check if the worker is healthy
   */
  isHealthy(): boolean {
    return this.healthy;
  }

  /**
   * Set cookies for session persistence
   */
  async setCookies(cookies: SessionCookie[]): Promise<void> {
    this.cookies = cookies;
    console.log(`[MCPWorker] Stored ${cookies.length} cookies for session ${this.sessionId}`);
  }

  /**
   * Get cookies for session
   */
  getCookies(): SessionCookie[] {
    return this.cookies;
  }

  /**
   * Get the MCP client instance
   */
  getClient(): Client | null {
    return this.client;
  }
}

/**
 * Worker manager for creating and managing per-session workers
 */
export class WorkerManager {
  private workers: Map<string, MCPWorker> = new Map();

  /**
   * Create a new worker for a session
   */
  async createWorker(sessionConfig: SessionConfig): Promise<MCPWorker> {
    const existing = this.workers.get(sessionConfig.session_id);
    if (existing) {
      return existing;
    }

    const worker = new PlaywrightMCPWorker(sessionConfig.session_id, {
      cdpEndpoint: sessionConfig.cdp_endpoint,
      viewportWidth: sessionConfig.viewport_width,
      viewportHeight: sessionConfig.viewport_height,
      browserType: sessionConfig.browser_type ?? 'chromium',
      visionEnabled: true, // Vision capabilities enabled per ARCHITECTURE.md
    });

    await worker.initialize();
    this.workers.set(sessionConfig.session_id, worker);

    return worker;
  }

  /**
   * Get an existing worker by session ID
   */
  getWorker(sessionId: string): MCPWorker | undefined {
    return this.workers.get(sessionId);
  }

  /**
   * Remove and terminate a worker
   */
  async removeWorker(sessionId: string): Promise<void> {
    const worker = this.workers.get(sessionId);
    if (worker) {
      await worker.terminate();
      this.workers.delete(sessionId);
    }
  }

  /**
   * Get all active worker IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Set cookies for a session
   */
  async setCookies(sessionId: string, cookies: SessionCookie[]): Promise<void> {
    const worker = this.workers.get(sessionId);
    if (worker) {
      await worker.setCookies(cookies);
    }
  }

  /**
   * Get cookies for a session
   */
  getCookies(sessionId: string): SessionCookie[] {
    const worker = this.workers.get(sessionId);
    return worker ? worker.getCookies() : [];
  }

  /**
   * Check health of all workers and cleanup unhealthy ones
   */
  async cleanupUnhealthyWorkers(): Promise<void> {
    const toRemove: string[] = [];

    for (const [sessionId, worker] of this.workers.entries()) {
      if (!worker.isHealthy()) {
        toRemove.push(sessionId);
      }
    }

    for (const sessionId of toRemove) {
      await this.removeWorker(sessionId);
    }
  }
}
