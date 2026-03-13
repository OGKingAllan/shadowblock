/**
 * ShadowBlock — Popup Controller
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentHostname = "";

// ── Animated counter ──────────────────────────────────────────────────────
function animateCount(element, target) {
  const current = parseInt(element.textContent.replace(/,/g, '')) || 0;
  if (current === target) return;

  const duration = 400;
  const start = performance.now();
  const diff = target - current;

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(current + diff * eased);
    element.textContent = value.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }

  element.classList.add('updating');
  requestAnimationFrame(tick);
  setTimeout(() => element.classList.remove('updating'), duration);
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Get current tab hostname
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      currentHostname = new URL(tab.url).hostname;
      $("#hostname").textContent = currentHostname;
    } catch {
      $("#hostname").textContent = "—";
    }
  }

  // Load state
  await loadState();
  await loadUpdateStatus();
  await loadUserRules();

  // Event listeners
  $("#siteToggle").addEventListener("change", toggleSite);
  $("#resetStats").addEventListener("click", resetStats);
  $("#updateFilters").addEventListener("click", triggerFilterUpdate);
  $("#saveRules").addEventListener("click", saveUserRules);

  // Ruleset toggles
  $$("[data-ruleset]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const rulesetId = e.target.dataset.ruleset;
      const enabled = e.target.checked;
      chrome.runtime.sendMessage({ type: "toggleRuleset", rulesetId, enabled });
    });
  });

  // Tab switching
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      const targetTab = e.target.dataset.tab;
      switchTab(targetTab);
    });
  });
});

// ── Background message listener (filter update progress indicator) ─────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'filterUpdateProgress') {
    const statusEl = $("#updateStatus");
    if (!statusEl) return;
    if (msg.status === 'error') {
      statusEl.textContent = `Update error: ${msg.list} — ${msg.error}`;
      statusEl.classList.add('error');
    } else if (msg.status === 'done') {
      statusEl.textContent = `Updated — ${msg.rulesApplied} rules active`;
      statusEl.classList.add('success');
      setTimeout(() => statusEl.classList.remove('success'), 4000);
    }
  }
});

// ── Tab Switching ─────────────────────────────────────────────────────────
function switchTab(tabName) {
  // Update tab buttons
  $$(".tab").forEach((t) => t.classList.remove("active"));
  $(`.tab[data-tab="${tabName}"]`).classList.add("active");

  // Update tab content
  $$(".tab-content").forEach((c) => c.classList.remove("active"));
  $(`#tab-${tabName}`).classList.add("active");
}

// ── Load state from background ─────────────────────────────────────────────
async function loadState() {
  const response = await chrome.runtime.sendMessage({
    type: "getState",
    hostname: currentHostname,
  });

  if (!response?.ok) return;

  // Site toggle
  $("#siteToggle").checked = response.enabled;
  document.body.classList.toggle("disabled", !response.enabled);

  // Stats
  const stats = response.stats || {};
  animateCount($("#siteBlocked"), stats.perSite?.[currentHostname] || 0);
  animateCount($("#totalBlocked"), stats.totalBlocked || 0);

  // Rulesets
  const rulesets = response.settings?.rulesets || {};
  for (const [id, enabled] of Object.entries(rulesets)) {
    const el = $(`[data-ruleset="${id}"]`);
    if (el) el.checked = enabled;
  }
}

// ── Filter Update Status ──────────────────────────────────────────────────
async function loadUpdateStatus() {
  const response = await chrome.runtime.sendMessage({ type: "getUpdateStatus" });
  if (!response?.ok) return;

  if (response.lastUpdate) {
    const date = new Date(response.lastUpdate);
    $("#lastUpdateText").textContent = `Last update: ${formatDate(date)}`;
  } else {
    $("#lastUpdateText").textContent = "Last update: never";
  }

  if (response.rulesApplied) {
    $("#updateStatus").textContent = `${response.rulesApplied} dynamic rules active`;
  }
}

async function triggerFilterUpdate() {
  const btn = $("#updateFilters");
  const statusEl = $("#updateStatus");

  btn.disabled = true;
  btn.textContent = "Updating...";
  statusEl.textContent = "Fetching filter lists...";

  try {
    const response = await chrome.runtime.sendMessage({ type: "forceFilterUpdate" });
    if (response?.ok) {
      if (response.updated) {
        statusEl.textContent = `Updated! ${response.rulesApplied} rules applied.`;
        statusEl.classList.add("success");
      } else {
        statusEl.textContent = "Filters are already up to date.";
      }
      await loadUpdateStatus();
    } else {
      statusEl.textContent = "Update failed. Try again later.";
      statusEl.classList.add("error");
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.classList.add("error");
  }

  btn.disabled = false;
  btn.textContent = "Update Now";

  // Clear status classes after a few seconds
  setTimeout(() => {
    statusEl.classList.remove("success", "error");
  }, 5000);
}

// ── User Rules ────────────────────────────────────────────────────────────
async function loadUserRules() {
  const response = await chrome.runtime.sendMessage({ type: "getUserRules" });
  if (!response?.ok) return;

  const rulesText = response.rules || "";
  $("#userRulesEditor").value = rulesText;
  renderRulesList(rulesText);
}

async function saveUserRules() {
  const btn = $("#saveRules");
  const rulesText = $("#userRulesEditor").value.trim();

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "saveUserRules",
      rulesText,
    });

    if (response?.ok) {
      const total = (response.networkRules || 0) + (response.cosmeticRules || 0);
      $("#rulesCount").textContent = `${total} rules active`;
      renderRulesList(rulesText);
    }
  } catch (err) {
    console.error("Failed to save rules:", err);
  }

  btn.disabled = false;
  btn.textContent = "Save Rules";
}

function renderRulesList(rulesText) {
  const listEl = $("#rulesList");
  const lines = rulesText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("!"));

  if (lines.length === 0) {
    listEl.innerHTML = '<div class="rules-empty">No custom rules added yet.</div>';
    $("#rulesCount").textContent = "0 rules active";
    return;
  }

  $("#rulesCount").textContent = `${lines.length} rules active`;
  listEl.innerHTML = "";

  for (let i = 0; i < lines.length; i++) {
    const rule = lines[i];
    const item = document.createElement("div");
    item.className = "rule-item";

    const ruleText = document.createElement("span");
    ruleText.className = "rule-text";
    ruleText.textContent = rule;

    // Tag for rule type
    const tag = document.createElement("span");
    if (rule.startsWith("@@")) {
      tag.className = "rule-tag exception";
      tag.textContent = "allow";
    } else if (rule.includes("##") || rule.includes("#@#")) {
      tag.className = "rule-tag cosmetic";
      tag.textContent = "cosmetic";
    } else {
      tag.className = "rule-tag network";
      tag.textContent = "block";
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "rule-delete";
    deleteBtn.textContent = "\u00D7";
    deleteBtn.title = "Delete this rule";
    deleteBtn.dataset.index = i;
    deleteBtn.addEventListener("click", (e) => {
      deleteRule(parseInt(e.target.dataset.index));
    });

    item.appendChild(tag);
    item.appendChild(ruleText);
    item.appendChild(deleteBtn);
    listEl.appendChild(item);
  }
}

function deleteRule(index) {
  const editor = $("#userRulesEditor");
  const lines = editor.value.split("\n");
  const nonEmptyLines = [];
  const lineMap = []; // maps non-empty index to original line index

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("!")) {
      lineMap.push(i);
      nonEmptyLines.push(lines[i]);
    }
  }

  if (index >= 0 && index < lineMap.length) {
    lines.splice(lineMap[index], 1);
    editor.value = lines.join("\n");
    saveUserRules();
  }
}

// ── Toggle site ────────────────────────────────────────────────────────────
async function toggleSite() {
  const enabled = $("#siteToggle").checked;
  document.body.classList.toggle("disabled", !enabled);

  // Background handler owns the stateChanged notification to content scripts.
  // Do NOT send a second direct tabs.sendMessage here — that causes double-firing.
  chrome.runtime.sendMessage({ type: "toggleSite", hostname: currentHostname });
}

// ── Reset stats ────────────────────────────────────────────────────────────
async function resetStats() {
  await chrome.runtime.sendMessage({ type: "resetStats" });
  animateCount($("#siteBlocked"), 0);
  animateCount($("#totalBlocked"), 0);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
