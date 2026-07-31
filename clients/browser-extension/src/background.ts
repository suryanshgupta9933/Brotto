/**
 * Background service worker for the Fara1.5 Browser Extension
 * Handles all extension lifecycle events, tab management, and relay coordination
 */

import * as crypto from "./crypto";
import * as pairing from "./pairing";
import * as debuggerModule from "./debugger";
import * as relay from "./relay";

export interface AutomationSession {
  id: string;
  tabId: number;
  tabGroupId?: number;
  startTime: number;
  relayUrl: string;
  sessionId: string;
  status: "active" | "disconnecting" | "disconnected";
}

const ACTIVE_SESSION_KEY = "activeAutomationSession";
const BADGE_ACTIVE_COLOR = "#22c55e"; // Green
const BADGE_INACTIVE_COLOR = "#6b7280"; // Gray

let activeSession: AutomationSession | null = null;

/**
 * Initialize the background service worker
 */
async function initialize(): Promise<void> {
  console.log("Fara1.5 extension initializing...");

  // Set up message handlers
  chrome.runtime.onMessage.addListener(handleMessage);

  // Set up extension install/update handlers
  chrome.runtime.onInstalled.addListener(handleInstalled);

  // Restore active session if any
  await restoreSession();

  // Update badge to show current state
  updateBadge();
}

/**
 * Handle messages from popup and content scripts
 */
async function handleMessage(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: Record<string, unknown>) => void
): Promise<void> {
  console.log("Background received message:", message.type);

  try {
    switch (message.type) {
      case "start_pairing":
        await handleStartPairing(message.serverUrl as string);
        sendResponse({ success: true });
        break;

      case "get_pairing_state":
        const state = await pairing.getPairingState();
        sendResponse({ success: true, state });
        break;

      case "exchange_pairing_code":
        const identity = await pairing.exchangePairingCode(
          message.serverUrl as string,
          message.code as string
        );
        sendResponse({ success: true, identity });
        break;

      case "authenticate":
        const tokens = await pairing.authenticate(
          message.serverUrl as string,
          message.deviceId as string,
          message.keyId as string
        );
        sendResponse({ success: true, tokens });
        break;

      case "get_session":
        sendResponse({ success: true, session: activeSession });
        break;

      case "start_automation":
        const startResult = await handleStartAutomation(
          message.tabId as number,
          message.relayUrl as string,
          message.sessionId as string
        );
        sendResponse(startResult);
        break;

      case "stop_automation":
        await handleStopAutomation();
        sendResponse({ success: true });
        break;

      case "get_tabs":
        const tabs = await getAvailableTabs();
        sendResponse({ success: true, tabs });
        break;

      case "get_tab_groups":
        const groups = await getTabGroups();
        sendResponse({ success: true, groups });
        break;

      case "check_tab_security":
        const security = await debuggerModule.checkTabSecurity(message.tabId as number);
        sendResponse({ success: true, security });
        break;

      case "get_connection_status":
        const status = relay.getConnectionState();
        sendResponse({ success: true, status });
        break;

      case "logout":
        await handleLogout();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: "Unknown message type" });
    }
  } catch (err) {
    console.error("Message handler error:", err);
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Handle extension install/update
 */
async function handleInstalled(
  details: chrome.runtime.InstalledDetails
): Promise<void> {
  if (details.reason === "install") {
    console.log("Extension installed");
    // Clear any stale data
    await chrome.storage.local.clear();
  } else if (details.reason === "update") {
    console.log("Extension updated to version", chrome.runtime.getManifest().version);
    // Handle migrations if needed
  }
}

/**
 * Handle start pairing request
 */
async function handleStartPairing(serverUrl: string): Promise<void> {
  const { pairingCode, expiresAt } = await pairing.initiatePairing(serverUrl);

  // Store the code for later exchange
  await chrome.storage.local.set({
    pendingPairingCode: pairingCode,
    pendingPairingExpiresAt: expiresAt,
    serverUrl
  });

  console.log(`Pairing code generated: ${pairingCode}, expires at ${new Date(expiresAt).toISOString()}`);
}

/**
 * Handle start automation request
 */
async function handleStartAutomation(
  tabId: number,
  relayUrl: string,
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  // Check if already have an active session
  if (activeSession && activeSession.status === "active") {
    return {
      success: false,
      error: "An automation session is already active"
    };
  }

  try {
    // Verify tab security
    const security = await debuggerModule.checkTabSecurity(tabId);
    if (!security.isSecure) {
      console.warn("Tab security warnings:", security.warnings);
      // Allow attachment but log warnings
    }

    // Attach debugger to tab
    const session = await debuggerModule.attachToTab(tabId);
    console.log(`Attached debugger to tab ${tabId}, session: ${session.sessionId}`);

    // Get authentication token
    const token = await pairing.getAccessToken();
    if (!token) {
      await debuggerModule.detachFromTab(tabId);
      return { success: false, error: "Not authenticated" };
    }

    // Connect to relay
    const storedIdentity = await chrome.storage.local.get("deviceIdentity");
    await relay.connect({
      relayUrl,
      sessionId,
      deviceId: storedIdentity.deviceIdentity?.deviceId || "",
      token,
      tenantId: storedIdentity.deviceIdentity?.tenantId
    });

    // Register CDP event handler
    debuggerModule.registerEventHandler(tabId, (event) => {
      relay.forwardCdpEvent(session, event.method, event.params);
    });

    // Create session record
    activeSession = {
      id: sessionId,
      tabId,
      startTime: Date.now(),
      relayUrl,
      sessionId: session.sessionId,
      status: "active"
    };

    // Persist session
    await chrome.storage.local.set({
      [ACTIVE_SESSION_KEY]: activeSession
    });

    // Update badge
    updateBadge();

    // Notify popup
    notifyPopup("session_started", activeSession);

    return { success: true };
  } catch (err) {
    console.error("Failed to start automation:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Handle stop automation request
 */
async function handleStopAutomation(): Promise<void> {
  if (!activeSession) {
    return;
  }

  activeSession.status = "disconnecting";
  notifyPopup("session_stopping", activeSession);

  try {
    // Disconnect relay first
    relay.disconnect();

    // Unregister event handlers
    debuggerModule.unregisterEventHandlers(activeSession.tabId);

    // Detach debugger
    await debuggerModule.detachFromTab(activeSession.tabId);

    // Clear session
    activeSession.status = "disconnected";
    await chrome.storage.local.remove(ACTIVE_SESSION_KEY);

    console.log(`Automation session ${activeSession.id} stopped`);
  } catch (err) {
    console.error("Error during cleanup:", err);
  } finally {
    activeSession = null;
    updateBadge();
    notifyPopup("session_stopped", null);
  }
}

/**
 * Handle logout request - revoke tokens and clear identity
 */
async function handleLogout(): Promise<void> {
  // Stop any active automation first
  if (activeSession) {
    await handleStopAutomation();
  }

  // Revoke tokens and clear identity
  await pairing.revokeAndClear();

  // Clear all storage
  await chrome.storage.local.clear();

  updateBadge();
  notifyPopup("logged_out", null);
}

/**
 * Restore session after service worker restart
 */
async function restoreSession(): Promise<void> {
  const stored = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
  if (stored[ACTIVE_SESSION_KEY]) {
    const session = stored[ACTIVE_SESSION_KEY] as AutomationSession;
    if (session.status === "active") {
      // Session was active but we lost connection
      // Don't auto-reconnect per architecture requirements
      console.log("Found inactive session, user must reconnect manually");
      session.status = "disconnected";
      activeSession = session;
    }
  }
}

/**
 * Get tabs available for automation
 */
async function getAvailableTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  // Filter to useful tabs (no chrome:// except devtools, etc.)
  return tabs.filter((tab) => {
    if (!tab.url) return false;
    // Exclude certain URLs
    const excluded = [
      "chrome://",
      "chrome-extension://",
      "about:",
      "file://",
      "devtools://"
    ];
    return !excluded.some((prefix) => tab.url!.startsWith(prefix));
  });
}

/**
 * Get tab groups
 */
async function getTabGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  return chrome.tabGroups.query({});
}

/**
 * Update extension badge
 */
function updateBadge(): void {
  if (activeSession && activeSession.status === "active") {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_ACTIVE_COLOR });
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setTitle({ title: "Fara1.5 - Automation Active" });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_INACTIVE_COLOR });
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Fara1.5 Browser Automation" });
  }
}

/**
 * Notify popup of state changes
 */
function notifyPopup(event: string, data: unknown): void {
  chrome.runtime.sendMessage({ type: event, data }).catch(() => {
    // Popup not open, ignore
  });
}

/**
 * Set up disconnect on socket close (cleanup)
 */
relay.onStatusChange((status) => {
  if (status === "disconnected" && activeSession) {
    // Relay disconnected unexpectedly
    console.log("Relay disconnected, cleaning up session");
    handleStopAutomation();
  }
});

// Initialize on service worker start
initialize().catch(console.error);

// Handle service worker shutdown/restart
self.addEventListener("unload", () => {
  console.log("Service worker unloading");
  if (activeSession && activeSession.status === "active") {
    // Don't auto-reconnect per architecture requirements
    console.log("Service worker stopping, session marked for manual reconnect");
  }
});
