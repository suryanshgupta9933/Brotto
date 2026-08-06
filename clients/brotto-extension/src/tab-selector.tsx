/**
 * Tab selection dialog component
 * Allows user to select one tab or a tab group for automation
 */

import React, { useState, useEffect } from "react";

interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  incognito: boolean;
  groupId?: number;
}

interface TabGroup {
  id: number;
  title: string;
  color: string;
  tabIds: number[];
}

interface SecurityCheck {
  isSecure: boolean;
  warnings: string[];
}

type SelectionMode = "single" | "group";

interface TabSelectorProps {
  onSelect: (tabId: number, securityWarnings: string[]) => void;
  onCancel: () => void;
}

const TabSelector: React.FC<TabSelectorProps> = ({ onSelect, onCancel }) => {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("single");
  const [securityWarnings, setSecurityWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTabsAndGroups();
  }, []);

  const loadTabsAndGroups = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [tabsResponse, groupsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: "get_tabs" }),
        chrome.runtime.sendMessage({ type: "get_tab_groups" })
      ]);

      if (tabsResponse.success) {
        setTabs(tabsResponse.tabs);
      } else {
        setError("Failed to load tabs");
      }

      if (groupsResponse.success) {
        setGroups(groupsResponse.groups);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTabSelect = async (tabId: number): Promise<void> => {
    setSelectedTabId(tabId);
    setSelectedGroupId(null);

    // Check tab security
    const response = await chrome.runtime.sendMessage({
      type: "check_tab_security",
      tabId
    });

    if (response.success) {
      setSecurityWarnings(response.security.warnings);
    }
  };

  const handleGroupSelect = (groupId: number): void => {
    setSelectedGroupId(groupId);
    setSelectedTabId(null);
    setSecurityWarnings([]);
  };

  const handleConfirm = (): void => {
    if (selectionMode === "single" && selectedTabId !== null) {
      onSelect(selectedTabId, securityWarnings);
    } else if (selectionMode === "group" && selectedGroupId !== null) {
      // For group selection, we'll use the first tab in the group
      const group = groups.find((g) => g.id === selectedGroupId);
      if (group && group.tabIds.length > 0) {
        onSelect(group.tabIds[0], []);
      }
    }
  };

  const renderTabItem = (tab: TabInfo): React.ReactNode => (
    <div
      key={tab.id}
      className={`tab-item ${selectedTabId === tab.id ? "selected" : ""}`}
      onClick={() => handleTabSelect(tab.id)}
    >
      {tab.favIconUrl ? (
        <img src={tab.favIconUrl} alt="" className="tab-icon" />
      ) : (
        <div className="tab-icon-placeholder" />
      )}
      <div className="tab-info">
        <span className="tab-title">{tab.title || "Untitled"}</span>
        <span className="tab-url">{truncateUrl(tab.url)}</span>
      </div>
      {tab.incognito && <span className="badge incognito">Incognito</span>}
    </div>
  );

  const renderGroupItem = (group: TabGroup): React.ReactNode => {
    const groupTabs = tabs.filter((t) => group.tabIds.includes(t.id));
    return (
      <div
        key={group.id}
        className={`group-item ${selectedGroupId === group.id ? "selected" : ""}`}
        onClick={() => handleGroupSelect(group.id)}
      >
        <div className="group-header">
          <span
            className="group-color"
            style={{ backgroundColor: group.color }}
          />
          <span className="group-title">{group.title || "Untitled Group"}</span>
          <span className="group-count">{group.tabIds.length} tabs</span>
        </div>
        <div className="group-tabs">
          {groupTabs.slice(0, 3).map((tab) => (
            <span key={tab.id} className="group-tab-preview">
              {tab.title || "Untitled"}
            </span>
          ))}
          {groupTabs.length > 3 && (
            <span className="group-tab-more">+{groupTabs.length - 3} more</span>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="tab-selector loading">
        <div className="spinner" />
        <p>Loading tabs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tab-selector error">
        <p className="error-message">{error}</p>
        <button onClick={loadTabsAndGroups} className="retry-button">
          Retry
        </button>
        <button onClick={onCancel} className="cancel-button">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="tab-selector">
      <header className="selector-header">
        <h2>Select Tab for Automation</h2>
        <div className="mode-toggle">
          <button
            className={selectionMode === "single" ? "active" : ""}
            onClick={() => setSelectionMode("single")}
          >
            Single Tab
          </button>
          <button
            className={selectionMode === "group" ? "active" : ""}
            onClick={() => setSelectionMode("group")}
          >
            Tab Group
          </button>
        </div>
      </header>

      <div className="selector-content">
        {selectionMode === "single" ? (
          <div className="tab-list">
            {tabs.length === 0 ? (
              <p className="empty-message">No available tabs found</p>
            ) : (
              tabs.map(renderTabItem)
            )}
          </div>
        ) : (
          <div className="group-list">
            {groups.length === 0 ? (
              <p className="empty-message">No tab groups found</p>
            ) : (
              groups.map(renderGroupItem)
            )}
          </div>
        )}
      </div>

      {securityWarnings.length > 0 && (
        <div className="security-warnings">
          <h3>Security Warnings</h3>
          <ul>
            {securityWarnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
          <p className="warning-note">
            This tab may contain sensitive information. Make sure you trust the
            site before proceeding.
          </p>
        </div>
      )}

      <footer className="selector-footer">
        <button onClick={onCancel} className="cancel-button">
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="confirm-button"
          disabled={
            selectionMode === "single"
              ? selectedTabId === null
              : selectedGroupId === null
          }
        >
          Attach to {selectionMode === "single" ? "Tab" : "Group"}
        </button>
      </footer>
    </div>
  );
};

function truncateUrl(url: string, maxLength = 50): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + "...";
}

export default TabSelector;
