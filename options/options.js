// ShadowBlock — Options Page
(() => {
  'use strict';

  // Nav section switching
  const navBtns = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.section');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('section-' + btn.dataset.section).classList.add('active');
    });
  });

  // Load state
  async function loadState() {
    const data = await chrome.storage.local.get(['settings', 'siteOverrides', 'stats', 'userCustomRules']);
    const settings = data.settings || {};

    document.getElementById('globalToggle').checked = settings.enabled !== false;
    document.getElementById('cosmeticToggle').checked = settings.cosmeticFiltering !== false;
    document.getElementById('antiAdblockToggle').checked = settings.antiAdblock !== false;
    document.getElementById('badgeToggle').checked = settings.showBadge !== false;

    document.querySelectorAll('[data-ruleset]').forEach(el => {
      el.checked = settings.rulesets?.[el.dataset.ruleset] !== false;
    });

    renderAllowlist(data.siteOverrides || {});
    document.getElementById('rulesEditor').value = data.userCustomRules || '';

    const stats = data.stats || {};
    document.getElementById('statTotal').textContent = (stats.totalBlocked || 0).toLocaleString();
    document.getElementById('statSession').textContent = (stats.sessionBlocked || 0).toLocaleString();
    renderTopDomains(stats.perSite || {});
  }

  // General toggles
  ['globalToggle', 'cosmeticToggle', 'antiAdblockToggle', 'badgeToggle'].forEach(id => {
    document.getElementById(id).addEventListener('change', async (e) => {
      const data = await chrome.storage.local.get(['settings']);
      const settings = data.settings || {};
      const map = { globalToggle: 'enabled', cosmeticToggle: 'cosmeticFiltering', antiAdblockToggle: 'antiAdblock', badgeToggle: 'showBadge' };
      settings[map[id]] = e.target.checked;
      await chrome.storage.local.set({ settings });
      chrome.runtime.sendMessage({ type: 'settingsChanged' });
    });
  });

  // Ruleset toggles
  document.querySelectorAll('[data-ruleset]').forEach(el => {
    el.addEventListener('change', async () => {
      await chrome.runtime.sendMessage({ type: 'toggleRuleset', rulesetId: el.dataset.ruleset, enabled: el.checked });
    });
  });

  // Filter update
  document.getElementById('updateAllBtn').addEventListener('click', async () => {
    const msg = document.getElementById('updateMsg');
    msg.textContent = 'Updating...';
    const result = await chrome.runtime.sendMessage({ type: 'forceFilterUpdate' });
    msg.textContent = result.ok ? 'Updated!' : 'Failed';
    setTimeout(() => { msg.textContent = ''; }, 3000);
  });

  // Allowlist
  function renderAllowlist(overrides) {
    const list = document.getElementById('allowlistEntries');
    list.innerHTML = '';
    const disabled = Object.entries(overrides).filter(([, v]) => v.enabled === false);
    if (disabled.length === 0) {
      const li = document.createElement('li');
      li.style.color = '#8b949e';
      li.textContent = 'No sites allowlisted';
      list.appendChild(li);
      return;
    }
    for (const [domain] of disabled) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = domain;
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.dataset.domain = domain;
      btn.addEventListener('click', async () => {
        const data = await chrome.storage.local.get(['siteOverrides']);
        const ov = data.siteOverrides || {};
        delete ov[domain];
        await chrome.storage.local.set({ siteOverrides: ov });
        renderAllowlist(ov);
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  document.getElementById('addAllowlistBtn').addEventListener('click', async () => {
    const input = document.getElementById('allowlistInput');
    let domain = input.value.trim().toLowerCase();
    if (!domain) return;

    // Strip protocol and path if user pasted a full URL
    try {
      if (domain.includes('://') || domain.includes('/')) {
        const url = new URL(domain.startsWith('http') ? domain : 'https://' + domain);
        domain = url.hostname;
      }
    } catch (_) {}

    // Strip www. prefix
    domain = domain.replace(/^www\./, '');

    // Basic domain validation
    if (!/^[a-z0-9]([a-z0-9-]*\.)*[a-z0-9]+\.[a-z]{2,}$/i.test(domain)) {
      input.style.borderColor = '#f85149';
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
      return;
    }

    const data = await chrome.storage.local.get(['siteOverrides']);
    const ov = data.siteOverrides || {};
    ov[domain] = { enabled: false };
    await chrome.storage.local.set({ siteOverrides: ov });
    renderAllowlist(ov);
    input.value = '';
  });

  // Rules
  document.getElementById('saveRulesBtn').addEventListener('click', async () => {
    const text = document.getElementById('rulesEditor').value;
    const result = await chrome.runtime.sendMessage({ type: 'saveUserRules', rulesText: text });
    const status = document.getElementById('rulesStatus');
    status.textContent = result.ok ? 'Saved!' : 'Error saving';
    status.style.color = result.ok ? '#3fb950' : '#f85149';
    setTimeout(() => { status.textContent = ''; }, 3000);
  });

  // Stats
  function renderTopDomains(perSite) {
    const container = document.getElementById('topDomains');
    container.innerHTML = '';
    const sorted = Object.entries(perSite).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (sorted.length === 0) {
      const p = document.createElement('p');
      p.style.color = '#8b949e';
      p.style.fontSize = '13px';
      p.textContent = 'Per-tab stats available in popup';
      container.appendChild(p);
      return;
    }
    for (const [domain, count] of sorted) {
      const row = document.createElement('div');
      row.className = 'domain-row';
      const domainSpan = document.createElement('span');
      domainSpan.textContent = domain;
      const countSpan = document.createElement('span');
      countSpan.className = 'count';
      countSpan.textContent = count.toLocaleString();
      row.appendChild(domainSpan);
      row.appendChild(countSpan);
      container.appendChild(row);
    }
  }

  document.getElementById('resetStatsBtn').addEventListener('click', async () => {
    if (!confirm('Reset all statistics?')) return;
    await chrome.runtime.sendMessage({ type: 'resetStats' });
    document.getElementById('statTotal').textContent = '0';
    document.getElementById('statSession').textContent = '0';
    document.getElementById('topDomains').innerHTML = '<p style="color:#8b949e;font-size:13px">No data yet</p>';
  });

  // Import/Export
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const EXPORT_KEYS = ['settings', 'siteOverrides', 'userCustomRules', 'stats', 'userRules'];
    const data = await chrome.storage.local.get(EXPORT_KEYS);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shadowblock-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Validate: only allow known keys to prevent XSS/injection via imported data
      const KNOWN_KEYS = new Set(['settings', 'siteOverrides', 'userCustomRules', 'stats', 'userRules']);
      const unknownKeys = Object.keys(data).filter(k => !KNOWN_KEYS.has(k));
      if (unknownKeys.length > 0) {
        alert('Import rejected: file contains unknown keys: ' + unknownKeys.join(', '));
        return;
      }
      // Only import the known subset
      const safeData = {};
      for (const key of KNOWN_KEYS) {
        if (key in data) safeData[key] = data[key];
      }
      await chrome.storage.local.set(safeData);
      loadState();
      alert('Settings imported!');
    } catch (err) {
      alert('Invalid file: ' + err.message);
    }
  });

  // Init
  loadState();
})();
