/**
 * ShadowBlock — Service Worker
 * Manages DNR rulesets, per-site settings, blocked request stats, and messaging.
 */

import { initFilterUpdater, forceUpdate, getUpdateStatus, applyUserRules } from "./filter-updater.js";
import { USER_RULE_ID_OFFSET } from "./constants.js";

// ── Initialize filter updater ───────────────────────────────────────────────
initFilterUpdater();

// ── State ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: true,
  cosmeticFiltering: true,
  antiAdblock: true,
  showBadge: true,
  rulesets: { ads: true, trackers: true, annoyances: true, redirects: true },
};

// ── Init ───────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.local.set({
      settings: DEFAULT_SETTINGS,
      siteOverrides: {},  // domain -> { enabled: bool }
      stats: { totalBlocked: 0, sessionBlocked: 0, perSite: {} },
      userRules: [],      // element picker custom rules
    });

    // Load anti-adblock rules into storage
    try {
      const resp = await fetch(chrome.runtime.getURL('data/anti-adblock-rules.json'));
      const antiAdblockRules = await resp.json();
      await chrome.storage.local.set({ antiAdblockRules });
    } catch (e) {
      console.warn('[ShadowBlock] Failed to load anti-adblock rules:', e);
    }

    // Load compiled cosmetic filters indexed by domain
    try {
      const resp = await fetch(chrome.runtime.getURL('data/cosmetic-filters.json'));
      const allCosmetic = await resp.json();
      await chrome.storage.local.set({ cosmeticIndex: allCosmetic });
    } catch (e) {
      console.warn('[ShadowBlock] Failed to load cosmetic filters:', e);
    }

    // Load compiled scriptlet rules
    try {
      const resp = await fetch(chrome.runtime.getURL('data/scriptlets.json'));
      const compiledScriptlets = await resp.json();
      await chrome.storage.local.set({ compiledScriptlets });
    } catch (e) {
      console.warn('[ShadowBlock] Failed to load scriptlet rules:', e);
    }
  }

  // Create context menu for element picker (on install AND update)
  // Remove all first to prevent duplication on extension update/reload
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "shadowblock-pick",
      title: "ShadowBlock: Block this element",
      contexts: ["all"],
    });
  });
});

// Ensure anti-adblock rules are always available (service worker can restart)
chrome.storage.local.get(['antiAdblockRules'], async (data) => {
  if (!data.antiAdblockRules) {
    try {
      const resp = await fetch(chrome.runtime.getURL('data/anti-adblock-rules.json'));
      const antiAdblockRules = await resp.json();
      await chrome.storage.local.set({ antiAdblockRules });
    } catch (e) {}
  }
});

// ── Context menu handler ────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "shadowblock-pick" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "activateElementPicker" });
  }
});

// ── Track blocked requests ─────────────────────────────────────────────────
let _statsBuffer = {};

function bufferStat(hostname) {
  _statsBuffer[hostname] = (_statsBuffer[hostname] || 0) + 1;
}

async function flushStats() {
  const buf = _statsBuffer;
  _statsBuffer = {};
  if (Object.keys(buf).length === 0) return;
  const { stats = { totalBlocked: 0, sessionBlocked: 0, perSite: {} } } = await chrome.storage.local.get('stats');
  for (const [host, count] of Object.entries(buf)) {
    stats.totalBlocked = (stats.totalBlocked || 0) + count;
    stats.sessionBlocked = (stats.sessionBlocked || 0) + count;
    stats.perSite = stats.perSite || {};
    stats.perSite[host] = (stats.perSite[host] || 0) + count;
  }
  await chrome.storage.local.set({ stats });
}

chrome.alarms.create('shadowblock-flush-stats', { periodInMinutes: 5 / 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'shadowblock-flush-stats') {
    flushStats();
  }
});

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const url = info.request?.url;
  if (!url) return;
  try {
    const hostname = new URL(info.request.initiator || url).hostname;
    bufferStat(hostname);
  } catch (_) {}
});

// ── Badge: show blocked count on icon ──────────────────────────────────────
async function updateBadge(tabId, hostname) {
  const data = await chrome.storage.local.get(["stats", "settings", "siteOverrides"]);
  const settings = data.settings || DEFAULT_SETTINGS;
  const overrides = data.siteOverrides || {};
  const siteEnabled = overrides[hostname]?.enabled ?? settings.enabled;

  if (!siteEnabled) {
    chrome.action.setBadgeText({ text: "OFF", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#888", tabId });
    return;
  }

  // Respect showBadge setting — hide badge entirely when disabled
  if (settings.showBadge === false) {
    chrome.action.setBadgeText({ text: "", tabId });
    return;
  }

  const count = data.stats?.perSite?.[hostname] || 0;
  const text = count > 999 ? "999+" : count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId });
}

// Update badge when tabs change
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    try {
      const hostname = new URL(tab.url).hostname;
      updateBadge(tabId, hostname);
    } catch (_) {}
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const hostname = new URL(tab.url).hostname;
      updateBadge(activeInfo.tabId, hostname);
    }
  } catch (_) {}
});

// ── Messaging (popup + content scripts) ────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });
  return true; // async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case "getState": {
      const hostname = msg.hostname;
      const data = await chrome.storage.local.get(["settings", "siteOverrides", "stats"]);
      const settings = data.settings || DEFAULT_SETTINGS;
      const overrides = data.siteOverrides || {};
      return {
        ok: true,
        enabled: overrides[hostname]?.enabled ?? settings.enabled,
        settings,
        siteOverrides: overrides,
        stats: data.stats || {},
        hostname,
      };
    }

    case "toggleSite": {
      const hostname = msg.hostname;
      const data = await chrome.storage.local.get(["settings", "siteOverrides"]);
      const overrides = data.siteOverrides || {};
      const currentState = overrides[hostname]?.enabled ?? data.settings?.enabled ?? true;
      const newState = !currentState;
      overrides[hostname] = { enabled: newState };
      await chrome.storage.local.set({ siteOverrides: overrides });

      const data2 = await chrome.storage.local.get(["siteAllowRuleMap"]);
      const siteAllowRuleMap = data2.siteAllowRuleMap || {};
      let allowId;
      if (siteAllowRuleMap[hostname]) {
        allowId = siteAllowRuleMap[hostname];
      } else {
        const usedIds = Object.values(siteAllowRuleMap);
        allowId = USER_RULE_ID_OFFSET + 90000;
        while (usedIds.includes(allowId)) {
          allowId++;
        }
        siteAllowRuleMap[hostname] = allowId;
        await chrome.storage.local.set({ siteAllowRuleMap });
      }
      if (!newState) {
        // Site disabled — add allow rule so DNR stops blocking on this domain
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [allowId],
          addRules: [{ id: allowId, priority: 9999, action: { type: 'allow' }, condition: { initiatorDomains: [hostname] } }]
        });
      } else {
        // Site re-enabled — remove the allow rule
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [allowId],
        });
      }

      // Notify content scripts on this tab
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "stateChanged",
          enabled: newState,
        }).catch(() => {});
      }

      return { ok: true, enabled: newState };
    }

    case "toggleGlobal": {
      const data = await chrome.storage.local.get(["settings"]);
      const settings = data.settings || DEFAULT_SETTINGS;
      settings.enabled = !settings.enabled;
      await chrome.storage.local.set({ settings });
      return { ok: true, enabled: settings.enabled };
    }

    case "toggleRuleset": {
      const { rulesetId, enabled } = msg;
      const data = await chrome.storage.local.get(["settings"]);
      const settings = data.settings || DEFAULT_SETTINGS;
      settings.rulesets[rulesetId] = enabled;
      await chrome.storage.local.set({ settings });

      // Enable/disable the DNR ruleset
      if (enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: [rulesetId],
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: [rulesetId],
        });
      }
      return { ok: true };
    }

    case "getStats": {
      const data = await chrome.storage.local.get(["stats"]);
      return { ok: true, stats: data.stats || {} };
    }

    case "resetStats": {
      await chrome.storage.local.set({
        stats: { totalBlocked: 0, sessionBlocked: 0, perSite: {} },
      });
      return { ok: true };
    }

    case "isEnabledForSite": {
      const hostname = msg.hostname;
      const data = await chrome.storage.local.get(["settings", "siteOverrides"]);
      const settings = data.settings || DEFAULT_SETTINGS;
      const overrides = data.siteOverrides || {};
      const enabled = overrides[hostname]?.enabled ?? settings.enabled;
      return { ok: true, enabled, cosmeticFiltering: settings.cosmeticFiltering, antiAdblock: settings.antiAdblock };
    }

    case "forceFilterUpdate": {
      const result = await forceUpdate();
      return { ok: true, ...result };
    }

    case "getUpdateStatus": {
      const status = await getUpdateStatus();
      return { ok: true, ...status };
    }

    case "applyUserRules": {
      const result = await applyUserRules(msg.rulesText);
      return { ok: true, ...result };
    }

    case "getUserRules": {
      const data = await chrome.storage.local.get(["userCustomRules"]);
      return { ok: true, rules: data.userCustomRules || "" };
    }

    case "saveUserRules": {
      await chrome.storage.local.set({ userCustomRules: msg.rulesText });
      const result = await applyUserRules(msg.rulesText);
      return { ok: true, ...result };
    }

    case "settingsChanged": {
      // Settings were updated externally (e.g. from options page) — reload from storage
      // This ensures the service worker picks up any changes immediately
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

