/**
 * Options page for the Fara1.5 Browser Extension
 * Allows users to configure extension settings
 */

import * as pairing from "./pairing";
import * as crypto from "./crypto";

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await setupEventListeners();
});

interface Settings {
  serverUrl: string;
  autoConnect: boolean;
  showNotifications: boolean;
  confirmBeforeAttach: boolean;
}

const defaultSettings: Settings = {
  serverUrl: "",
  autoConnect: false,
  showNotifications: true,
  confirmBeforeAttach: true
};

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(["settings", "deviceIdentity"]);

  if (stored.settings) {
    updateForm(stored.settings as Settings);
  }

  if (stored.deviceIdentity) {
    displayDeviceInfo(stored.deviceIdentity);
  }
}

function updateForm(settings: Settings): void {
  const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
  const autoConnectInput = document.getElementById("autoConnect") as HTMLInputElement;
  const showNotificationsInput = document.getElementById("showNotifications") as HTMLInputElement;
  const confirmBeforeAttachInput = document.getElementById("confirmBeforeAttach") as HTMLInputElement;

  if (serverUrlInput) serverUrlInput.value = settings.serverUrl;
  if (autoConnectInput) autoConnectInput.checked = settings.autoConnect;
  if (showNotificationsInput) showNotificationsInput.checked = settings.showNotifications;
  if (confirmBeforeAttachInput) confirmBeforeAttachInput.checked = settings.confirmBeforeAttach;
}

function displayDeviceInfo(identity: { deviceId: string; keyId: string; pairedAt: number }): void {
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

async function setupEventListeners(): Promise<void> {
  // Save settings
  const saveButton = document.getElementById("saveSettings");
  if (saveButton) {
    saveButton.addEventListener("click", handleSaveSettings);
  }

  // Reset settings
  const resetButton = document.getElementById("resetSettings");
  if (resetButton) {
    resetButton.addEventListener("click", handleResetSettings);
  }

  // Unpair device
  const unpairButton = document.getElementById("unpairDevice");
  if (unpairButton) {
    unpairButton.addEventListener("click", handleUnpairDevice);
  }

  // Generate new key pair
  const newKeyButton = document.getElementById("generateNewKey");
  if (newKeyButton) {
    newKeyButton.addEventListener("click", handleGenerateNewKey);
  }
}

async function handleSaveSettings(): Promise<void> {
  const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
  const autoConnectInput = document.getElementById("autoConnect") as HTMLInputElement;
  const showNotificationsInput = document.getElementById("showNotifications") as HTMLInputElement;
  const confirmBeforeAttachInput = document.getElementById("confirmBeforeAttach") as HTMLInputElement;

  const settings: Settings = {
    serverUrl: serverUrlInput?.value || "",
    autoConnect: autoConnectInput?.checked || false,
    showNotifications: showNotificationsInput?.checked || true,
    confirmBeforeAttach: confirmBeforeAttachInput?.checked || true
  };

  await chrome.storage.local.set({ settings });

  showMessage("Settings saved successfully", "success");
}

async function handleResetSettings(): Promise<void> {
  await chrome.storage.local.set({ settings: defaultSettings });
  updateForm(defaultSettings);
  showMessage("Settings reset to defaults", "success");
}

async function handleUnpairDevice(): Promise<void> {
  const confirmed = confirm(
    "Are you sure you want to unpair this device? You will need to pair again to use the extension."
  );

  if (!confirmed) return;

  await pairing.revokeAndClear();
  await chrome.storage.local.clear();

  const deviceInfoDiv = document.getElementById("deviceInfo");
  if (deviceInfoDiv) {
    deviceInfoDiv.innerHTML = "";
  }

  showMessage("Device unpaired", "success");
}

async function handleGenerateNewKey(): Promise<void> {
  const confirmed = confirm(
    "Generate a new device key? This will require re-pairing with the server."
  );

  if (!confirmed) return;

  try {
    const keys = await crypto.generateDeviceKeyPair();
    await crypto.storeDeviceKeys(keys);
    showMessage(`New key generated with ID: ${keys.keyId}`, "success");
  } catch (err) {
    showMessage(`Failed to generate key: ${err}`, "error");
  }
}

function showMessage(message: string, type: "success" | "error"): void {
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
