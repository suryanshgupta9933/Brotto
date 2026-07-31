/**
 * Popup JavaScript - Compiled from popup.tsx
 * Note: For a real extension, use a bundler like webpack or esbuild
 */

// Simple popup implementation using vanilla JS since we can't bundle React easily
document.addEventListener("DOMContentLoaded", () => {
  initPopup();
});

async function initPopup() {
  const root = document.getElementById("root");
  if (!root) return;

  // Simple state
  let state = {
    view: "main",
    pairingState: null,
    session: null,
    tabs: [],
    selectedTabId: null,
    error: null,
    loading: false
  };

  // Initial load
  await loadState();

  // Render loop
  render();

  async function loadState() {
    try {
      const [stateResponse, sessionResponse] = await Promise.all([
        sendMessage({ type: "get_pairing_state" }),
        sendMessage({ type: "get_session" })
      ]);

      if (stateResponse.success) {
        state.pairingState = stateResponse.state;
      }

      if (sessionResponse.success && sessionResponse.session) {
        state.session = sessionResponse.session;
        if (sessionResponse.session.status === "active") {
          state.view = "automation_active";
        }
      }
    } catch (err) {
      console.error("Failed to load state:", err);
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { success: false, error: "No response" });
      });
    });
  }

  function render() {
    switch (state.view) {
      case "main":
        root.innerHTML = renderMain();
        attachMainListeners();
        break;
      case "tab_selector":
        root.innerHTML = renderTabSelector();
        attachTabSelectorListeners();
        break;
      case "automation_active":
        root.innerHTML = renderAutomationActive();
        attachAutomationActiveListeners();
        break;
      default:
        root.innerHTML = renderMain();
        attachMainListeners();
    }
  }

  function renderMain() {
    return `
      <div class="popup-container">
        <header class="popup-header">
          <h1>Fara1.5</h1>
          <span class="status-badge ${state.session?.status === 'active' ? 'connected' : 'disconnected'}">
            ${state.session?.status === 'active' ? 'Active' : 'Ready'}
          </span>
        </header>
        <main class="popup-content">
          ${state.error ? `<div class="error-message">${state.error}</div>` : ""}
          ${state.session?.status === 'active' ? renderActiveSession() : renderMainActions()}
        </main>
        <footer class="popup-footer">
          <button class="text-button" id="logoutBtn">Logout</button>
        </footer>
      </div>
    `;
  }

  function renderActiveSession() {
    const duration = Math.floor((Date.now() - state.session.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `
      <div class="active-session">
        <h2>Automation Active</h2>
        <p>Tab ${state.session.tabId} is being automated</p>
        <p>Started: ${new Date(state.session.startTime).toLocaleTimeString()}</p>
        <p>Duration: ${minutes}:${seconds.toString().padStart(2, '0')}</p>
        <button class="primary" id="viewSessionBtn">View Session</button>
      </div>
    `;
  }

  function renderMainActions() {
    return `
      <div class="actions">
        <button class="primary" id="startAutomationBtn" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? 'Loading...' : 'Start Automation'}
        </button>
      </div>
    `;
  }

  function renderTabSelector() {
    const tabItems = state.tabs.map(tab => `
      <div class="tab-item ${state.selectedTabId === tab.id ? 'selected' : ''}" data-tab-id="${tab.id}">
        ${tab.favIconUrl ? `<img src="${tab.favIconUrl}" alt="" class="tab-icon">` : '<div class="tab-icon-placeholder"></div>'}
        <div class="tab-info">
          <span class="tab-title">${tab.title || 'Untitled'}</span>
          <span class="tab-url">${truncateUrl(tab.url)}</span>
        </div>
        ${tab.incognito ? '<span class="badge incognito">Incognito</span>' : ''}
      </div>
    `).join('');

    return `
      <div class="popup-container">
        <header class="popup-header">
          <button class="back-button" id="backBtn">Back</button>
          <h1>Select Tab</h1>
        </header>
        <main class="popup-content">
          ${state.error ? `<div class="error-message">${state.error}</div>` : ''}
          <div class="tab-list">
            ${tabItems || '<p class="empty-message">No available tabs found</p>'}
          </div>
          <div class="warning-box">
            <strong>Warning:</strong> The extension will attach to the selected tab.
            Only select tabs you intend to automate.
          </div>
          <button class="primary full-width" id="attachBtn" ${state.selectedTabId === null || state.loading ? 'disabled' : ''}>
            ${state.loading ? 'Connecting...' : 'Attach to Tab'}
          </button>
        </main>
      </div>
    `;
  }

  function renderAutomationActive() {
    const duration = Math.floor((Date.now() - state.session.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `
      <div class="popup-container">
        <header class="popup-header">
          <h1>Active Session</h1>
        </header>
        <main class="popup-content">
          <div class="session-info">
            <div class="session-stat">
              <span class="label">Status</span>
              <span class="value active">Active</span>
            </div>
            <div class="session-stat">
              <span class="label">Duration</span>
              <span class="value">${minutes}:${seconds.toString().padStart(2, '0')}</span>
            </div>
            <div class="session-stat">
              <span class="label">Tab ID</span>
              <span class="value">${state.session.tabId}</span>
            </div>
          </div>
          <div class="actions">
            <button class="danger" id="stopBtn" ${state.loading ? 'disabled' : ''}>
              ${state.loading ? 'Stopping...' : 'Stop Automation'}
            </button>
          </div>
        </main>
      </div>
    `;
  }

  function truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + "...";
  }

  function attachMainListeners() {
    const startBtn = document.getElementById("startAutomationBtn");
    const viewBtn = document.getElementById("viewSessionBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    if (startBtn) {
      startBtn.addEventListener("click", async () => {
        state.loading = true;
        render();
        try {
          const response = await sendMessage({ type: "get_tabs" });
          if (response.success) {
            state.tabs = response.tabs;
            state.view = "tab_selector";
          } else {
            state.error = "Failed to load tabs";
          }
        } catch (err) {
          state.error = err.message;
        } finally {
          state.loading = false;
          render();
        }
      });
    }

    if (viewBtn) {
      viewBtn.addEventListener("click", () => {
        state.view = "automation_active";
        render();
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await sendMessage({ type: "logout" });
        state.pairingState = null;
        state.session = null;
        state.view = "main";
        render();
      });
    }
  }

  function attachTabSelectorListeners() {
    const backBtn = document.getElementById("backBtn");
    const attachBtn = document.getElementById("attachBtn");
    const tabItems = document.querySelectorAll(".tab-item");

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        state.view = "main";
        state.selectedTabId = null;
        render();
      });
    }

    tabItems.forEach(item => {
      item.addEventListener("click", () => {
        state.selectedTabId = parseInt(item.dataset.tabId, 10);
        render();
      });
    });

    if (attachBtn) {
      attachBtn.addEventListener("click", async () => {
        if (state.selectedTabId === null) return;
        state.loading = true;
        render();

        try {
          const relayUrl = "wss://relay.fara1.5.example.com/ws";
          const sessionId = `session-${Date.now()}`;

          const response = await sendMessage({
            type: "start_automation",
            tabId: state.selectedTabId,
            relayUrl,
            sessionId
          });

          if (response.success) {
            state.session = response.session;
            state.view = "automation_active";
          } else {
            state.error = response.error || "Failed to start automation";
          }
        } catch (err) {
          state.error = err.message;
        } finally {
          state.loading = false;
          render();
        }
      });
    }
  }

  function attachAutomationActiveListeners() {
    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) {
      stopBtn.addEventListener("click", async () => {
        state.loading = true;
        render();
        try {
          await sendMessage({ type: "stop_automation" });
          state.session = null;
          state.view = "main";
        } catch (err) {
          state.error = err.message;
        } finally {
          state.loading = false;
          render();
        }
      });
    }
  }
}
