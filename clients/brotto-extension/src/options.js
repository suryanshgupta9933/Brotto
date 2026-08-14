/**
 * Options page JavaScript
 */

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  setupEventListeners();
});

async function loadSettings() {
  const stored = await chrome.storage.local.get(["settings", "deviceIdentity"]);

  if (stored.settings) {
    updateForm(stored.settings);
  }

  if (stored.deviceIdentity) {
    displayDeviceInfo(stored.deviceIdentity);
  }
}

function updateForm(settings) {
  const serverUrlInput = document.getElementById("serverUrl");
  const autoConnectInput = document.getElementById("autoConnect");
  const showNotificationsInput = document.getElementById("showNotifications");
  const confirmBeforeAttachInput = document.getElementById("confirmBeforeAttach");

  if (serverUrlInput) serverUrlInput.value = settings.serverUrl || "";
  if (autoConnectInput) autoConnectInput.checked = settings.autoConnect || false;
  if (showNotificationsInput) showNotificationsInput.checked = settings.showNotifications !== false;
  if (confirmBeforeAttachInput) confirmBeforeAttachInput.checked = settings.confirmBeforeAttach !== false;
}

function displayDeviceInfo(identity) {
  const deviceInfoDiv = document.getElementById("deviceInfo");
  if (deviceInfoDiv) {
    deviceInfoDiv.innerHTML = `
      <div class="device-info">
        <h3>Paired Device</h3>
        <p><strong>Device ID:</strong> ${identity.deviceId}</p>
        <p><strong>Key ID:</strong> ${identity.keyId}</p>
        <p><strong>Paired:</strong> ${new Date(identity.pairedAt).toLocaleString()}</p>
      </div>
    `;
  }
}

function setupEventListeners() {
  const saveButton = document.getElementById("saveSettings");
  const resetButton = document.getElementById("resetSettings");
  const unpairButton = document.getElementById("unpairDevice");
  const generateNewKeyButton = document.getElementById("generateNewKey");

  if (saveButton) {
    saveButton.addEventListener("click", handleSaveSettings);
  }

  if (resetButton) {
    resetButton.addEventListener("click", handleResetSettings);
  }

  if (unpairButton) {
    unpairButton.addEventListener("click", handleUnpairDevice);
  }

  if (generateNewKeyButton) {
    generateNewKeyButton.addEventListener("click", handleGenerateNewKey);
  }
}

async function handleSaveSettings() {
  const serverUrlInput = document.getElementById("serverUrl");
  const autoConnectInput = document.getElementById("autoConnect");
  const showNotificationsInput = document.getElementById("showNotifications");
  const confirmBeforeAttachInput = document.getElementById("confirmBeforeAttach");

  const settings = {
    serverUrl: serverUrlInput?.value || "",
    autoConnect: autoConnectInput?.checked || false,
    showNotifications: showNotificationsInput?.checked !== false,
    confirmBeforeAttach: confirmBeforeAttachInput?.checked !== false
  };

  await chrome.storage.local.set({ settings });
  showMessage("Settings saved successfully", "success");
}

async function handleResetSettings() {
  const defaultSettings = {
    serverUrl: "",
    autoConnect: false,
    showNotifications: true,
    confirmBeforeAttach: true
  };
  await chrome.storage.local.set({ settings: defaultSettings });
  updateForm(defaultSettings);
  showMessage("Settings reset to defaults", "success");
}

async function handleUnpairDevice() {
  const confirmed = confirm(
    "Are you sure you want to unpair this device? You will need to pair again to use the extension."
  );

  if (!confirmed) return;

  await chrome.storage.local.clear();
  const deviceInfoDiv = document.getElementById("deviceInfo");
  if (deviceInfoDiv) {
    deviceInfoDiv.innerHTML = '<p style="color: #9ca3af;">No device paired</p>';
  }
  showMessage("Device unpaired", "success");
}

async function handleGenerateNewKey() {
  const confirmed = confirm(
    "Generate a new device key? This will require re-pairing with the server."
  );

  if (!confirmed) return;

  try {
    // Generate a random key ID (actual key generation would require WebCrypto)
    const keyId = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");

    await chrome.storage.local.set({
      deviceKeys: {
        keyId,
        createdAt: Date.now()
      }
    });

    showMessage(`New key generated with ID: ${keyId}`, "success");
  } catch (err) {
    showMessage(`Failed to generate key: ${err}`, "error");
  }
}

function showMessage(message, type) {
  const messageDiv = document.getElementById("message");
  if (messageDiv) {
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = "block";

    setTimeout(() => {
      messageDiv.style.display = "none";
    }, 5000);
  }
}
