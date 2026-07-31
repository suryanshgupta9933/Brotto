/**
 * Browser MCP Gateway Server
 * Main entry point for the MCP gateway service
 */

import { WorkerManager, type MCPWorker } from './worker.js';
import { FaraActionAdapter, AccessibilityVerifier, DISABLED_TOOLS } from './adapter.js';
import type { SessionConfig, FaraAction, ToolCallResult } from './types.js';
import { z } from 'zod';

/**
 * Gateway server configuration
 */
export interface GatewayConfig {
  port: number;
  host: string;
  cdpRelayUrl?: string;
  maxConcurrentSessions?: number;
  sessionTimeoutMs?: number;
}

/**
 * Create default gateway configuration
 */
export function createDefaultConfig(): GatewayConfig {
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    host: process.env.HOST || '127.0.0.1', // Internal only - not exposed to public
    cdpRelayUrl: process.env.CDP_RELAY_URL,
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '100', 10),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000', 10), // 1 hour default
  };
}

/**
 * Gateway server that routes Fara actions to Playwright MCP
 */
export class BrowserMCPGateway {
  private config: GatewayConfig;
  private workerManager: WorkerManager;
  private server: any; // Would be HTTP/WebSocket server in production

  constructor(config: GatewayConfig) {
    this.config = config;
    this.workerManager = new WorkerManager();
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    console.log(`[BrowserMCPGateway] Starting on ${this.config.host}:${this.config.port}`);
    console.log(`[BrowserMCPGateway] CDP Relay: ${this.config.cdpRelayUrl || 'not configured'}`);

    // In production, this would start an HTTP/WebSocket server
    // For now, just log that we're "started"
    console.log('[BrowserMCPGateway] Gateway ready');
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    console.log('[BrowserMCPGateway] Shutting down...');

    // Cleanup all workers
    const sessions = this.workerManager.getActiveSessions();
    for (const sessionId of sessions) {
      await this.workerManager.removeWorker(sessionId);
    }

    console.log('[BrowserMCPGateway] Shutdown complete');
  }

  /**
   * Create a new session and return its worker
   */
  async createSession(sessionConfig: SessionConfig): Promise<MCPWorker> {
    if (this.workerManager.getActiveSessions().length >= (this.config.maxConcurrentSessions || 100)) {
      throw new Error('Maximum concurrent sessions reached');
    }

    const worker = await this.workerManager.createWorker(sessionConfig);
    return worker;
  }

  /**
   * Get an existing session's worker
   */
  getSession(sessionId: string): MCPWorker | undefined {
    return this.workerManager.getWorker(sessionId);
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.workerManager.removeWorker(sessionId);
  }

  /**
   * Execute a Fara action for a session
   */
  async executeAction(sessionId: string, action: FaraAction): Promise<ToolCallResult> {
    const worker = this.workerManager.getWorker(sessionId);
    if (!worker) {
      return {
        success: false,
        error: `Session ${sessionId} not found`,
      };
    }

    if (!worker.isHealthy()) {
      return {
        success: false,
        error: `Session ${sessionId} is not healthy`,
      };
    }

    return worker.adapter.executeAction(action);
  }

  /**
   * Get list of available tools (filtered to safe subset)
   */
  async getAvailableTools(sessionId: string): Promise<string[]> {
    const worker = this.workerManager.getWorker(sessionId);
    if (!worker) {
      return [];
    }

    return worker.adapter.getAllowedTools();
  }

  /**
   * Get disabled tools list
   */
  getDisabledTools(): string[] {
    return Array.from(DISABLED_TOOLS);
  }

  /**
   * Get gateway metrics
   */
  getMetrics(): GatewayMetrics {
    return {
      activeSessions: this.workerManager.getActiveSessions().length,
      maxSessions: this.config.maxConcurrentSessions || 100,
      disabledTools: this.getDisabledTools(),
    };
  }
}

export interface GatewayMetrics {
  activeSessions: number;
  maxSessions: number;
  disabledTools: string[];
}

/**
 * Request validation schemas
 */
export const CreateSessionSchema = z.object({
  session_id: z.string().min(1),
  cdp_endpoint: z.string().url(),
  viewport_width: z.number().positive().max(4096),
  viewport_height: z.number().positive().max(4096),
  browser_type: z.enum(['chromium', 'firefox', 'webkit']).optional().default('chromium'),
  profile_dir: z.string().optional(),
});

export const ExecuteActionSchema = z.object({
  session_id: z.string().min(1),
  action: z.object({
    type: z.string(),
    // Additional fields validated per action type
    x: z.number().optional(),
    y: z.number().optional(),
    start_x: z.number().optional(),
    start_y: z.number().optional(),
    end_x: z.number().optional(),
    end_y: z.number().optional(),
    delta_x: z.number().optional(),
    delta_y: z.number().optional(),
    key: z.string().optional(),
    url: z.string().optional(),
    duration_ms: z.number().optional(),
    question: z.string().optional(),
    options: z.array(z.string()).optional(),
    reason: z.string().optional(),
    fact: z.string().optional(),
    observation_id: z.string().optional(),
  }),
});

/**
 * Main entry point
 */
async function main() {
  const config = createDefaultConfig();
  const gateway = new BrowserMCPGateway(config);

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    await gateway.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await gateway.stop();
    process.exit(0);
  });

  await gateway.start();
}

// Run if executed directly
main().catch((error) => {
  console.error('[BrowserMCPGateway] Fatal error:', error);
  process.exit(1);
});

export { main };
