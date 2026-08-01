/**
 * Action Executor for the Fara1.5 Browser Extension
 * Translates Fara actions into CDP commands and executes them via chrome.debugger
 */

import { sendCommand, type DebuggerSession } from "./debugger";

/**
 * Fara action types that the extension can execute
 */
export type FaraActionType =
  | 'left_click'
  | 'double_click'
  | 'right_click'
  | 'mouse_move'
  | 'scroll'
  | 'key'
  | 'visit_url'
  | 'history_back'
  | 'screenshot'
  | 'type_text'
  | 'waiting_for_login'  // NEW
  | 'save_session';     // NEW

export interface FaraActionBase {
  type: FaraActionType;
  observation_id?: string;
}

export interface ClickAction extends FaraActionBase {
  type: 'left_click' | 'double_click' | 'right_click';
  x: number;
  y: number;
}

export interface MouseMoveAction extends FaraActionBase {
  type: 'mouse_move';
  x: number;
  y: number;
}

export interface ScrollAction extends FaraActionBase {
  type: 'scroll';
  delta_x?: number;
  delta_y?: number;
}

export interface KeyAction extends FaraActionBase {
  type: 'key';
  key: string;
}

export interface VisitUrlAction extends FaraActionBase {
  type: 'visit_url';
  url: string;
}

export interface HistoryBackAction extends FaraActionBase {
  type: 'history_back';
}

export interface ScreenshotAction extends FaraActionBase {
  type: 'screenshot';
}

export interface TypeTextAction extends FaraActionBase {
  type: 'type_text';
  text: string;
}

export interface WaitingForLoginAction extends FaraActionBase {
  type: 'waiting_for_login';
  reason: string;
}

export interface SaveSessionAction extends FaraActionBase {
  type: 'save_session';
}

export type FaraAction =
  | ClickAction
  | MouseMoveAction
  | ScrollAction
  | KeyAction
  | VisitUrlAction
  | HistoryBackAction
  | ScreenshotAction
  | TypeTextAction
  | WaitingForLoginAction
  | SaveSessionAction;

/**
 * Result of executing an action
 */
export interface ActionResult {
  success: boolean;
  error?: string;
  data?: unknown;
  observation_id?: string;
}

/**
 * Mapping from Fara actions to CDP commands
 */
export class ActionExecutor {
  private session: DebuggerSession;
  private tabId: number;

  constructor(session: DebuggerSession) {
    this.session = session;
    this.tabId = session.tabId;
  }

  /**
   * Execute a Fara action and return the result
   */
  async executeAction(action: FaraAction): Promise<ActionResult> {
    try {
      switch (action.type) {
        case 'left_click':
        case 'double_click':
        case 'right_click':
          return await this.executeClick(action);

        case 'mouse_move':
          return await this.executeMouseMove(action);

        case 'scroll':
          return await this.executeScroll(action);

        case 'key':
          return await this.executeKey(action);

        case 'visit_url':
          return await this.executeVisitUrl(action);

        case 'history_back':
          return await this.executeHistoryBack();

        case 'screenshot':
          return await this.executeScreenshot();

        case 'type_text':
          return await this.executeTypeText(action);

        case 'waiting_for_login':
          return { success: true, data: { reason: action.reason } };
        case 'save_session':
          return { success: true };

        default:
          return { success: false, error: `Unknown action type: ${(action as FaraAction).type}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Click at coordinates
   */
  private async executeClick(action: ClickAction): Promise<ActionResult> {
    const button = action.type === 'right_click' ? 'right' : 'left';
    const clickCount = action.type === 'double_click' ? 2 : 1;

    // Mouse move to position first
    await sendCommand(this.tabId, {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseMoved',
        x: action.x,
        y: action.y,
      },
    });

    // Mouse press
    await sendCommand(this.tabId, {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x: action.x,
        y: action.y,
        button,
        clickCount,
      },
    });

    // Mouse release
    await sendCommand(this.tabId, {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseReleased',
        x: action.x,
        y: action.y,
        button,
        clickCount,
      },
    });

    return { success: true, data: { x: action.x, y: action.y, button, clickCount } };
  }

  /**
   * Move mouse to coordinates
   */
  private async executeMouseMove(action: MouseMoveAction): Promise<ActionResult> {
    await sendCommand(this.tabId, {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseMoved',
        x: action.x,
        y: action.y,
      },
    });

    return { success: true, data: { x: action.x, y: action.y } };
  }

  /**
   * Scroll the page
   */
  private async executeScroll(action: ScrollAction): Promise<ActionResult> {
    await sendCommand(this.tabId, {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel',
        x: action.delta_x ?? 0,
        y: action.delta_y ?? 0,
      },
    });

    return { success: true, data: { delta_x: action.delta_x, delta_y: action.delta_y } };
  }

  /**
   * Press a key
   */
  private async executeKey(action: KeyAction): Promise<ActionResult> {
    await sendCommand(this.tabId, {
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyPressed',
        key: action.key,
      },
    });

    await sendCommand(this.tabId, {
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyReleased',
        key: action.key,
      },
    });

    return { success: true, data: { key: action.key } };
  }

  /**
   * Navigate to a URL
   */
  private async executeVisitUrl(action: VisitUrlAction): Promise<ActionResult> {
    // Validate URL scheme - only allow HTTP and HTTPS
    try {
      const url = new URL(action.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return {
          success: false,
          error: `Invalid URL scheme: ${url.protocol}. Only http and https are allowed.`,
        };
      }
    } catch {
      return { success: false, error: `Invalid URL: ${action.url}` };
    }

    await sendCommand(this.tabId, {
      method: 'Page.navigate',
      params: { url: action.url },
    });

    return { success: true, data: { url: action.url } };
  }

  /**
   * Go back in browser history
   */
  private async executeHistoryBack(): Promise<ActionResult> {
    await sendCommand(this.tabId, {
      method: 'Navigation.navigateBack',
      params: {},
    });

    return { success: true };
  }

  /**
   * Take a screenshot
   */
  private async executeScreenshot(): Promise<ActionResult> {
    const result = await sendCommand(this.tabId, {
      method: 'Page.captureScreenshot',
      params: { format: 'png' },
    });

    return { success: true, data: result };
  }

  /**
   * Type text into the focused element
   */
  private async executeTypeText(action: TypeTextAction): Promise<ActionResult> {
    // First, focus on an input field if needed - dispatch key events for each character
    for (const char of action.text) {
      await sendCommand(this.tabId, {
        method: 'Input.dispatchKeyEvent',
        params: {
          type: 'keyDown',
          text: char,
        },
      });

      await sendCommand(this.tabId, {
        method: 'Input.dispatchKeyEvent',
        params: {
          type: 'keyUp',
          text: char,
        },
      });
    }

    return { success: true, data: { text: action.text } };
  }
}

/**
 * Get the current URL from the page
 */
export async function getCurrentUrl(tabId: number): Promise<string | null> {
  try {
    const result = await sendCommand(tabId, {
      method: 'Page.getNavigationHistory',
      params: {},
    }) as { currentIndex: number; entries: Array<{ url: string }> };

    if (result && result.entries && result.entries.length > 0) {
      return result.entries[result.currentIndex]?.url || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get page title
 */
export async function getPageTitle(tabId: number): Promise<string | null> {
  try {
    const result = await sendCommand(tabId, {
      method: 'Page.getFrameTree',
      params: {},
    });
    return (result as { frameTree?: { frame?: { name?: string } } })?.frameTree?.frame?.name || null;
  } catch {
    return null;
  }
}
