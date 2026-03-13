/**
 * ShadowBlock — Filter Auto-Updater
 * Periodically fetches updated filter lists, parses ABP rules into DNR format,
 * and applies them as dynamic rules.
 */

import { USER_RULE_ID_OFFSET, DYNAMIC_RULE_ID_OFFSET } from "./constants.js";

// ── Configuration ───────────────────────────────────────────────────────────
const FILTER_URLS = {
  easylist: "https://easylist.to/easylist/easylist.txt",
  easyprivacy: "https://easylist.to/easylist/easyprivacy.txt",
};

const UPDATE_ALARM_NAME = "shadowblock-filter-update";
const UPDATE_INTERVAL_HOURS = 24;
const STORAGE_KEY = "filterUpdateState";
const MAX_DYNAMIC_RULES = 4900; // Chrome limit is 5000, leave buffer

// ── Initialization ──────────────────────────────────────────────────────────
export async function initFilterUpdater() {
  // Set up the periodic alarm
  const existing = await chrome.alarms.get(UPDATE_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(UPDATE_ALARM_NAME, {
      delayInMinutes: 1, // First check 1 min after install
      periodInMinutes: UPDATE_INTERVAL_HOURS * 60,
    });
  }

  // Listen for alarm fires
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM_NAME) {
      checkForUpdates();
    }
    if (alarm.name === 'shadowblock-clear-badge') {
      chrome.action.setBadgeText({ text: "" });
    }
  });

  // Check on startup if stale (>24h since last update)
  const state = await getUpdateState();
  const hoursSinceUpdate = (Date.now() - (state.lastUpdate || 0)) / (1000 * 60 * 60);
  if (hoursSinceUpdate >= UPDATE_INTERVAL_HOURS) {
    checkForUpdates();
  }
}

// ── State Management ────────────────────────────────────────────────────────
async function getUpdateState() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return data[STORAGE_KEY] || {
    lastUpdate: 0,
    listVersions: {},
    rulesApplied: 0,
    lastError: null,
  };
}

async function saveUpdateState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

// ── Update Check ────────────────────────────────────────────────────────────
export async function checkForUpdates() {
  const state = await getUpdateState();
  let totalNewRules = [];
  let updated = false;

  for (const [listName, url] of Object.entries(FILTER_URLS)) {
    try {
      // Fetch with If-Modified-Since if we have a previous date
      const headers = {};
      if (state.listVersions[listName]?.lastModified) {
        headers["If-Modified-Since"] = state.listVersions[listName].lastModified;
      }

      const response = await fetch(url, { headers, cache: "no-cache" });

      // 304 = not modified, skip
      if (response.status === 304) continue;
      if (!response.ok) {
        const errMsg = `HTTP ${response.status}`;
        console.warn(`[ShadowBlock] Failed to fetch ${listName}: ${errMsg}`);
        state.lastError = { list: listName, message: errMsg, at: Date.now() };
        chrome.runtime.sendMessage({
          type: 'filterUpdateProgress',
          status: 'error',
          list: listName,
          error: errMsg,
        }).catch(() => {});
        continue;
      }

      const text = await response.text();
      const lastModified = response.headers.get("Last-Modified") || new Date().toUTCString();

      // Check if content actually changed via SHA-256
      const hash = await sha256Hash(text);
      if (state.listVersions[listName]?.hash === hash) continue;

      // Parse ABP rules into DNR format
      const rules = parseAbpToDnr(text, listName);
      totalNewRules.push(...rules);

      // Update version tracking
      state.listVersions[listName] = {
        lastModified,
        hash,
        ruleCount: rules.length,
        fetchedAt: Date.now(),
      };

      updated = true;
    } catch (err) {
      console.warn(`[ShadowBlock] Error updating ${listName}:`, err.message);
      state.lastError = { list: listName, message: err.message, at: Date.now() };
      // Notify popup that update failed so it can show an error indicator
      chrome.runtime.sendMessage({
        type: 'filterUpdateProgress',
        status: 'error',
        list: listName,
        error: err.message,
      }).catch(() => {});
    }
  }

  if (updated && totalNewRules.length > 0) {
    await applyDynamicRules(totalNewRules);
    state.rulesApplied = Math.min(totalNewRules.length, MAX_DYNAMIC_RULES);
    showUpdateBadge(state.rulesApplied);
    // Notify popup that update completed successfully
    chrome.runtime.sendMessage({
      type: 'filterUpdateProgress',
      status: 'done',
      rulesApplied: state.rulesApplied,
    }).catch(() => {});
  }

  state.lastUpdate = Date.now();
  await saveUpdateState(state);

  return { updated, rulesApplied: state.rulesApplied };
}

// ── ABP-to-DNR Parser (Basic — handles ~80% of common rules) ───────────────
function parseAbpToDnr(abpText, listName) {
  const lines = abpText.split("\n");
  const rules = [];
  let ruleId = DYNAMIC_RULE_ID_OFFSET + (listName === "easyprivacy" ? 50000 : 0);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments, empty lines, metadata
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    // Skip cosmetic rules (##, #@#, #?#) — handled by content script
    if (line.includes("##") || line.includes("#@#") || line.includes("#?#")) continue;

    // Skip rules with unsupported options we can't map
    if (line.includes("$rewrite") || line.includes("$csp") || line.includes("$redirect")) continue;

    try {
      const rule = parseAbpRule(line, ruleId);
      if (rule) {
        rules.push(rule);
        ruleId++;
      }
    } catch (_) {
      // Skip unparseable rules silently
    }

    // Respect dynamic rule limit
    if (rules.length >= MAX_DYNAMIC_RULES / 2) break; // Split limit across lists
  }

  return rules;
}

function parseAbpRule(line, ruleId) {
  const isException = line.startsWith("@@");
  const raw = isException ? line.slice(2) : line;

  // Extract options after $
  let pattern = raw;
  let options = {};
  const dollarIdx = raw.lastIndexOf("$");
  if (dollarIdx >= 0) {
    const optStr = raw.slice(dollarIdx + 1);
    pattern = raw.slice(0, dollarIdx);
    options = parseAbpOptions(optStr);
  }

  // Skip if we can't handle the options
  if (options._skip) return null;

  let urlFilter = null;
  let requestDomains = undefined;

  // Pattern: ||domain.com^ (domain block)
  if (pattern.startsWith("||") && pattern.endsWith("^")) {
    const domain = pattern.slice(2, -1);
    if (!isValidDomain(domain)) return null;
    urlFilter = `||${domain}^`;
  }
  // Pattern: ||domain.com (domain prefix)
  else if (pattern.startsWith("||")) {
    const domain = pattern.slice(2);
    if (domain.includes("*") || domain.includes("^")) {
      // Convert to urlFilter with wildcards
      urlFilter = `||${domain}`;
    } else if (isValidDomain(domain)) {
      urlFilter = `||${domain}`;
    } else {
      return null;
    }
  }
  // Pattern: |https://... (exact start)
  else if (pattern.startsWith("|") && !pattern.startsWith("||")) {
    urlFilter = pattern;
  }
  // Pattern: /path or keyword
  else if (pattern.length > 3 && (!pattern.includes("*") || pattern.includes("/"))) {
    urlFilter = pattern;
  } else {
    return null;
  }

  if (!urlFilter || urlFilter.length < 3) return null;

  // Build the DNR rule
  const rule = {
    id: ruleId,
    priority: isException ? 2 : 1,
    action: {
      type: isException ? "allow" : "block",
    },
    condition: {
      urlFilter,
    },
  };

  // Apply domain restrictions from options
  if (options.domains?.length) {
    rule.condition.initiatorDomains = options.domains;
  }
  if (options.excludedDomains?.length) {
    rule.condition.excludedInitiatorDomains = options.excludedDomains;
  }

  // Apply resource type restrictions
  if (options.resourceTypes?.length) {
    rule.condition.resourceTypes = options.resourceTypes;
  }

  return rule;
}

function parseAbpOptions(optStr) {
  const opts = {
    domains: [],
    excludedDomains: [],
    resourceTypes: [],
    _skip: false,
  };

  const ABP_TO_DNR_TYPES = {
    script: "script",
    image: "image",
    stylesheet: "stylesheet",
    font: "font",
    media: "media",
    object: "object",
    xmlhttprequest: "xmlhttprequest",
    subdocument: "sub_frame",
    websocket: "websocket",
    ping: "ping",
    popup: "main_frame",
    "object-subrequest": "object",
    other: "other",
  };

  for (const opt of optStr.split(",")) {
    const trimmed = opt.trim();

    // Domain restrictions
    if (trimmed.startsWith("domain=")) {
      const domainParts = trimmed.slice(7).split("|");
      for (const d of domainParts) {
        if (d.startsWith("~")) {
          opts.excludedDomains.push(d.slice(1));
        } else {
          opts.domains.push(d);
        }
      }
      continue;
    }

    // Third-party (handled by static compiler — skip in dynamic parser)
    if (trimmed === "third-party" || trimmed === "~third-party") {
      continue;
    }

    // Resource types
    const isNegated = trimmed.startsWith("~");
    const typeName = isNegated ? trimmed.slice(1) : trimmed;
    if (ABP_TO_DNR_TYPES[typeName]) {
      if (!isNegated) {
        opts.resourceTypes.push(ABP_TO_DNR_TYPES[typeName]);
      }
      // Negated types are complex — skip for now
    }

    // Unsupported options
    if (["rewrite", "csp", "redirect", "removeparam", "header"].includes(typeName)) {
      opts._skip = true;
    }
  }

  return opts;
}

function isValidDomain(str) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(str);
}

async function sha256Hash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Apply Dynamic Rules ─────────────────────────────────────────────────────
async function applyDynamicRules(newRules) {
  // Get existing dynamic rules to remove them
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter((r) => r.id >= DYNAMIC_RULE_ID_OFFSET && r.id < USER_RULE_ID_OFFSET)
    .map((r) => r.id);

  // Trim to max allowed
  const rulesToAdd = newRules.slice(0, MAX_DYNAMIC_RULES);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rulesToAdd,
  });

  console.log(`[ShadowBlock] Applied ${rulesToAdd.length} dynamic rules (removed ${removeRuleIds.length} old ones)`);
}

// ── User Custom Rules ───────────────────────────────────────────────────────

export async function applyUserRules(rulesText) {
  const lines = rulesText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("!"));
  const dnrRules = [];
  const cosmeticRules = [];
  let ruleId = USER_RULE_ID_OFFSET;

  for (const line of lines) {
    // Cosmetic rules go to content script
    if (line.includes("##") || line.includes("#@#")) {
      cosmeticRules.push(line);
      continue;
    }

    const rule = parseAbpRule(line, ruleId);
    if (rule) {
      dnrRules.push(rule);
      ruleId++;
    }
  }

  // Remove old user rules and apply new ones
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter((r) => r.id >= USER_RULE_ID_OFFSET && r.id < USER_RULE_ID_OFFSET + 90000)
    .map((r) => r.id);

  const rulesToAdd = dnrRules.slice(0, 100); // Cap user rules

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rulesToAdd,
  });

  // Store cosmetic rules for content script
  await chrome.storage.local.set({ userCosmeticRules: cosmeticRules });

  return { networkRules: rulesToAdd.length, cosmeticRules: cosmeticRules.length };
}

// ── Badge Notification ──────────────────────────────────────────────────────
function showUpdateBadge(ruleCount) {
  chrome.action.setBadgeText({ text: "UPD" });
  chrome.action.setBadgeBackgroundColor({ color: "#238636" });

  // Clear the update badge after 30 seconds (use alarm instead of setTimeout for SW safety)
  chrome.alarms.create('shadowblock-clear-badge', { delayInMinutes: 0.5 });
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function getUpdateStatus() {
  const state = await getUpdateState();
  return {
    lastUpdate: state.lastUpdate,
    rulesApplied: state.rulesApplied,
    listVersions: state.listVersions,
    lastError: state.lastError,
  };
}

export async function forceUpdate() {
  return checkForUpdates();
}
