/**
 * Background service worker for the Fara1.5 Browser Extension
 * Handles all extension lifecycle events, tab management, and relay coordination
 */

// Note: This is the compiled JavaScript version
// Source TypeScript is in background.ts

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};

/** Active session storage key */
const ACTIVE_SESSION_KEY = "activeAutomationSession";
/** Badge colors */
const BADGE_ACTIVE_COLOR = "#22c55e";
const BADGE_INACTIVE_COLOR = "#6b7280";

let activeSession = null;

/**
 * Initialize the background service worker
 */
function initialize() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Fara1.5 extension initializing...");
        // Set up message handlers
        chrome.runtime.onMessage.addListener(handleMessage);
        // Set up extension install/update handlers
        chrome.runtime.onInstalled.addListener(handleInstalled);
        // Restore active session if any
        yield restoreSession();
        // Update badge to show current state
        updateBadge();
    });
}

/**
 * Handle messages from popup and content scripts
 */
function handleMessage(message, sender, sendResponse) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Background received message:", message.type);
        try {
            switch (message.type) {
                case "get_pairing_state":
                    const state = yield pairing.getPairingState();
                    sendResponse({ success: true, state });
                    break;
                case "get_session":
                    sendResponse({ success: true, session: activeSession });
                    break;
                case "get_tabs":
                    const tabs = yield getAvailableTabs();
                    sendResponse({ success: true, tabs });
                    break;
                case "get_tab_groups":
                    const groups = yield getTabGroups();
                    sendResponse({ success: true, groups });
                    break;
                case "check_tab_security":
                    const security = yield debuggerModule.checkTabSecurity(message.tabId);
                    sendResponse({ success: true, security });
                    break;
                case "get_connection_status":
                    const status = relay.getConnectionState();
                    sendResponse({ success: true, status });
                    break;
                case "logout":
                    yield handleLogout();
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ success: false, error: "Unknown message type" });
            }
        }
        catch (err) {
            console.error("Message handler error:", err);
            sendResponse({
                success: false,
                error: err instanceof Error ? err.message : String(err)
            });
        }
    });
}

/**
 * Handle extension install/update
 */
function handleInstalled(details) {
    return __awaiter(this, void 0, void 0, function* () {
        if (details.reason === "install") {
            console.log("Extension installed");
            yield chrome.storage.local.clear();
        }
        else if (details.reason === "update") {
            console.log("Extension updated to version", chrome.runtime.getManifest().version);
        }
    });
}

/**
 * Get tabs available for automation
 */
function getAvailableTabs() {
    return __awaiter(this, void 0, void 0, function* () {
        const tabs = yield chrome.tabs.query({});
        return tabs.filter((tab) => {
            if (!tab.url)
                return false;
            const excluded = [
                "chrome://",
                "chrome-extension://",
                "about:",
                "file://",
                "devtools://"
            ];
            return !excluded.some((prefix) => tab.url.startsWith(prefix));
        });
    });
}

/**
 * Get tab groups
 */
function getTabGroups() {
    return __awaiter(this, void 0, void 0, function* () {
        return chrome.tabGroups.query({});
    });
}

/**
 * Update extension badge
 */
function updateBadge() {
    if (activeSession && activeSession.status === "active") {
        chrome.action.setBadgeBackgroundColor({ color: BADGE_ACTIVE_COLOR });
        chrome.action.setBadgeText({ text: "ON" });
        chrome.action.setTitle({ title: "Fara1.5 - Automation Active" });
    }
    else {
        chrome.action.setBadgeBackgroundColor({ color: BADGE_INACTIVE_COLOR });
        chrome.action.setBadgeText({ text: "" });
        chrome.action.setTitle({ title: "Fara1.5 Browser Automation" });
    }
}

/**
 * Notify popup of state changes
 */
function notifyPopup(event, data) {
    chrome.runtime.sendMessage({ type: event, data }).catch(() => {
        // Popup not open, ignore
    });
}

/**
 * Restore session after service worker restart
 */
function restoreSession() {
    return __awaiter(this, void 0, void 0, function* () {
        const stored = yield chrome.storage.local.get(ACTIVE_SESSION_KEY);
        if (stored[ACTIVE_SESSION_KEY]) {
            const session = stored[ACTIVE_SESSION_KEY];
            if (session.status === "active") {
                console.log("Found inactive session, user must reconnect manually");
                session.status = "disconnected";
                activeSession = session;
            }
        }
    });
}

/**
 * Handle logout request - revoke tokens and clear identity
 */
function handleLogout() {
    return __awaiter(this, void 0, void 0, function* () {
        if (activeSession) {
            // Stop any active automation first
        }
        // Clear all storage
        yield chrome.storage.local.clear();
        updateBadge();
        notifyPopup("logged_out", null);
    });
}

// Placeholder imports - in compiled version these would be bundled
// @ts-nocheck
const pairing = {
    getPairingState: () => Promise.resolve({ status: "idle", serverUrl: null, error: null }),
    revokeAndClear: () => Promise.resolve()
};
const debuggerModule = {
    checkTabSecurity: (tabId) => Promise.resolve({ isSecure: true, warnings: [] })
};
const relay = {
    getConnectionState: () => ({ connected: false, reconnectAttempts: 0, config: null })
};

// Initialize on service worker start
initialize().catch(console.error);
