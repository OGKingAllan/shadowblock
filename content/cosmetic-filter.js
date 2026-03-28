/**
 * ShadowBlock — Cosmetic Filter (Content Script)
 * Injected at document_start in all frames.
 *
 * Strategy:
 * 1. Inject generic + domain-specific CSS to hide known ad elements BEFORE render
 * 2. MutationObserver catches dynamically inserted ads
 * 3. Uses CSS-only hiding (no DOM removal) to avoid anti-adblock detection
 * 4. Spoofs layout APIs so hidden elements still report visible dimensions
 */

(() => {
  "use strict";

  // ── Check if enabled for this site ─────────────────────────────────────
  let isEnabled = true;
  let cosmeticEnabled = true;

  const hostname = location.hostname;

  chrome.runtime.sendMessage(
    { type: "isEnabledForSite", hostname },
    (response) => {
      void chrome.runtime.lastError; // Suppress "no receiving end" errors on disconnected pages
      if (response && !response.enabled) {
        isEnabled = false;
        removeInjectedStyles();
      }
      if (response && !response.cosmeticFiltering) {
        cosmeticEnabled = false;
        removeInjectedStyles();
      }
    }
  );

  // Listen for toggle changes
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stateChanged") {
      isEnabled = msg.enabled;
      if ('cosmeticFiltering' in msg) {
        cosmeticEnabled = msg.cosmeticFiltering;
      }
      if (!isEnabled || !cosmeticEnabled) {
        removeInjectedStyles();
      } else {
        injectStyles();
        loadUserRules();
        loadCompiledSelectors();
      }
    }
  });

  // ── Generic ad selectors (work across most sites) ──────────────────────
  const GENERIC_SELECTORS = [
    // Common ad container classes/IDs
    '[id^="google_ads"]',
    '[id^="div-gpt-ad"]',
    '[id*="ad-container"]',
    '[id*="ad_container"]',
    '[id*="adslot"]',
    '[id*="ad-slot"]',
    '[class*="ad-container"]',
    '[class*="ad_container"]',
    '[class*="adsbygoogle"]',
    '[class*="ad-wrapper"]',
    '[class*="ad_wrapper"]',
    '[class*="ad-banner"]',
    '[class*="ad_banner"]',
    '[class*="ad-unit"]',
    '[class*="ad_unit"]',
    '[class*="ad-placement"]',
    '[class*="sponsored-content"]',
    '[class*="sponsor-banner"]',

    // Ad network elements
    'ins.adsbygoogle',
    'amp-ad',
    'amp-embed[type="ad"]',
    'amp-sticky-ad',

    // Common ad iframes
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="googleadservices"]',
    'iframe[src*="amazon-adsystem"]',
    'iframe[src*="adnxs.com"]',
    'iframe[src*="rubiconproject"]',
    'iframe[src*="casalemedia"]',
    'iframe[src*="taboola"]',
    'iframe[src*="outbrain"]',
    'iframe[id*="google_ads"]',

    // Taboola / Outbrain / content recommendation spam
    '[id*="taboola"]',
    '[class*="taboola"]',
    '[id*="outbrain"]',
    '[class*="outbrain"]',
    '.OUTBRAIN',
    '[data-widget-type="taboola"]',

    // Generic patterns
    '[aria-label="advertisement"]',
    '[aria-label="Advertisement"]',
    '[aria-label="Ads"]',
    '[data-ad]',
    '[data-ad-slot]',
    '[data-ad-unit]',
    '[data-adunit]',
    '[data-google-query-id]',
    '[data-native-ad]',
    '[data-ad-module]',
  ];

  // ── Domain-specific selectors ──────────────────────────────────────────
  // These target ads on popular sites that use custom ad containers
  const DOMAIN_SELECTORS = {
    "youtube.com": [
      "ytd-ad-slot-renderer",
      "ytd-banner-promo-renderer",
      "ytd-promoted-sparkles-web-renderer",
      "ytd-display-ad-renderer",
      "ytd-promoted-video-renderer",
      "#player-ads",
      "#masthead-ad",
      'ytd-rich-item-renderer:has(.ytd-ad-slot-renderer)',
      ".ytp-ad-module",
      ".ytp-ad-overlay-container",
      ".ytp-ad-text-overlay",
      ".video-ads",
      "#related ytd-promoted-sparkles-web-renderer",
    ],
    "facebook.com": [
      '[data-pagelet*="FeedUnit"]:has(a[href*="/ads/"])',
      'div[data-testid="fbfeed_story"]:has(a[href*="facebook.com/ads"])',
      '[aria-label="Sponsored"]',
    ],
    "twitter.com": [
      '[data-testid="placementTracking"]',
      'article:has(div[dir="ltr"] > span:only-child)',
    ],
    "x.com": [
      '[data-testid="placementTracking"]',
    ],
    "reddit.com": [
      ".promotedlink",
      'shreddit-ad-post',
      '[data-testid="ad-post"]',
      '[class*="promoted"]',
      ".ad-container",
    ],
    "instagram.com": [
      // Note: :contains() is not valid CSS — detection done via MutationObserver text check below
      '[data-testid="post-container"]:has(a[href*="/ads/"])',
      '[data-testid="post-container"]:has([aria-label="Sponsored"])',
    ],
    "tiktok.com": [
      '[class*="DivAdBadge"]',
      '[data-e2e="ad-tag"]',
    ],
    "twitch.tv": [
      '[data-test-selector="ad-banner-default-layout"]',
      ".stream-display-ad__container",
    ],
    "linkedin.com": [
      // Note: :contains() is not valid CSS — detection done via MutationObserver text check below
      ".feed-shared-update-v2:has([data-control-name='actor_container'])[data-urn*='sponsored']",
      '[data-id*="urn:li:sponsoredCreative"]',
      '[data-ad-banner]',
    ],
    "cnn.com": [
      ".ad-slot",
      '[data-ad-section]',
      ".ad__container",
    ],
    "nytimes.com": [
      '[data-testid="StandardAd"]',
      '[data-testid="CompanionAd"]',
      ".ad-container",
    ],
    "forbes.com": [
      ".ad-unit",
      '[class*="ad-"]',
      "#article-stream-ad",
    ],
  };

  // ── Style injection ────────────────────────────────────────────────────
  const STYLE_ID = "__sb_cosmetic";

  function buildCSS() {
    const rules = [];

    // Generic selectors
    const genericRule = GENERIC_SELECTORS.join(",\n");
    rules.push(`${genericRule} {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  z-index: -9999 !important;
  clip-path: inset(100%) !important;
}`);

    // Domain-specific selectors
    const domainParts = hostname.replace(/^www\./, "");
    for (const [domain, selectors] of Object.entries(DOMAIN_SELECTORS)) {
      if (domainParts === domain || domainParts.endsWith("." + domain)) {
        const domRule = selectors.join(",\n");
        rules.push(`${domRule} {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  z-index: -9999 !important;
  clip-path: inset(100%) !important;
}`);
        break;
      }
    }

    return rules.join("\n\n");
  }

  function injectStyles() {
    if (!isEnabled || !cosmeticEnabled) return;
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCSS();

    // Inject into <html> since <head> may not exist yet at document_start
    (document.head || document.documentElement).appendChild(style);
  }

  function removeInjectedStyles() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  // ── User Rules (element picker custom blocks) ─────────────────────────
  const USER_STYLE_ID = "__sb_user_rules";

  function loadUserRules() {
    if (!isEnabled || !cosmeticEnabled) return;

    chrome.storage.local.get(["userRules"], (data) => {
      const rules = data.userRules || [];
      if (rules.length === 0) return;

      const currentHost = location.hostname;
      const applicableRules = rules.filter(
        (r) => r.domain === "*" || r.domain === currentHost
      );

      if (applicableRules.length === 0) return;

      // Remove existing user style if present
      const existing = document.getElementById(USER_STYLE_ID);
      if (existing) existing.remove();

      const css = applicableRules.map((r) => `${r.selector} {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  overflow: hidden !important;
  clip-path: inset(100%) !important;
}`).join("\n\n");

      const style = document.createElement("style");
      style.id = USER_STYLE_ID;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    });
  }

  // Listen for storage changes (new rules added by element picker)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.userRules) {
      loadUserRules();
    }
  });

  // Inject immediately at document_start
  injectStyles();
  loadUserRules();

  // ── MutationObserver for dynamic ads ───────────────────────────────────
  const AD_PATTERNS = [
    /\bad[\s_-]?(container|wrapper|banner|slot|unit|placement|module)\b/i,
    /\badsbygoogle\b/i,
    /\bsponsored\b/i,
    /\btaboola\b/i,
    /\boutbrain\b/i,
    /\bgoogle[_-]?ad/i,
    /\bdiv-gpt-ad/i,
  ];

  function isAdElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const id = el.id || "";
    const cls = el.className || "";
    const combined = id + " " + (typeof cls === "string" ? cls : "");
    return AD_PATTERNS.some((pat) => pat.test(combined));
  }

  let mutationBatch = [];
  let mutationTimer = null;

  function processMutationBatch() {
    if (!isEnabled || !cosmeticEnabled) return;

    const elements = mutationBatch.splice(0);
    for (const el of elements) {
      if (isAdElement(el) && el.isConnected) {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("height", "0", "important");
        el.style.setProperty("overflow", "hidden", "important");
        el.style.setProperty("clip-path", "inset(100%)", "important");
      }
    }
    mutationTimer = null;
  }

  function onMutation(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          mutationBatch.push(node);
          // Also check children (ads can be nested)
          const children = node.querySelectorAll?.("*");
          if (children) {
            for (const child of children) {
              if (isAdElement(child)) mutationBatch.push(child);
            }
          }
        }
      }
    }

    // Debounce: process batch every 100ms
    if (!mutationTimer && mutationBatch.length > 0) {
      mutationTimer = setTimeout(processMutationBatch, 200);
    }
  }

  // Start observing once body exists
  function startObserver() {
    if (!document.body) {
      // Body doesn't exist yet at document_start — wait for it
      const bodyWait = new MutationObserver(() => {
        if (document.body) {
          bodyWait.disconnect();
          attachObserver();
        }
      });
      bodyWait.observe(document.documentElement, { childList: true });
    } else {
      attachObserver();
    }
  }

  function attachObserver() {
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  startObserver();

  // ── Text-content based sponsored detection (replaces invalid :contains() CSS) ──
  // Used for Instagram and LinkedIn where sponsored labels are in text nodes.
  const SPONSORED_TEXT_SITES = ['instagram.com', 'linkedin.com'];
  const domainPart = hostname.replace(/^www\./, '');
  if (SPONSORED_TEXT_SITES.some(s => domainPart === s || domainPart.endsWith('.' + s))) {
    const SPONSORED_TERMS = ['Sponsored', 'Promoted', 'Ad'];

    function checkNodeForSponsoredText(node) {
      if (!node || node.nodeType !== 1) return;
      // Only check article/feed item-level elements to avoid thrashing
      const tag = node.tagName;
      if (tag !== 'ARTICLE' && tag !== 'DIV' && tag !== 'LI') return;
      const text = node.textContent;
      if (!text) return;
      for (const term of SPONSORED_TERMS) {
        if (text.includes(term)) {
          // Confirm the term appears in a small span/label (not just article body text)
          const labels = node.querySelectorAll('span, a, div[aria-label]');
          for (const label of labels) {
            if (label.childElementCount === 0 && label.textContent.trim() === term) {
              node.style.setProperty('display', 'none', 'important');
              node.style.setProperty('visibility', 'hidden', 'important');
              node.style.setProperty('height', '0', 'important');
              node.style.setProperty('overflow', 'hidden', 'important');
              break;
            }
          }
          break;
        }
      }
    }

    const sponsoredObserver = new MutationObserver((mutations) => {
      if (!isEnabled || !cosmeticEnabled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          checkNodeForSponsoredText(node);
        }
      }
    });

    function startSponsoredObserver() {
      if (!document.body) return;
      sponsoredObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) {
      startSponsoredObserver();
    } else {
      document.addEventListener('DOMContentLoaded', startSponsoredObserver);
    }
  }

  // Re-inject styles if they get removed (some sites try to strip injected styles)
  let styleCheckIntervalId = setInterval(() => {
    // Stop checking when disabled or tab is hidden
    if (!isEnabled || !cosmeticEnabled) {
      clearInterval(styleCheckIntervalId);
      styleCheckIntervalId = null;
      return;
    }
    if (document.hidden) return; // Skip work on invisible tabs
    if (!document.getElementById(STYLE_ID)) {
      injectStyles();
    }
  }, 5000);

  // Restart interval when re-enabled
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stateChanged" && msg.enabled && !styleCheckIntervalId) {
      styleCheckIntervalId = setInterval(() => {
        if (!isEnabled || !cosmeticEnabled) {
          clearInterval(styleCheckIntervalId);
          styleCheckIntervalId = null;
          return;
        }
        if (document.hidden) return;
        if (!document.getElementById(STYLE_ID)) {
          injectStyles();
        }
      }, 5000);
    }
  });

  // ── Load compiled domain-specific selectors from storage ──────────────
  function loadCompiledSelectors() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.local.get(['cosmeticIndex'], (data) => {
      if (!data.cosmeticIndex || !cosmeticEnabled) return;
      const index = data.cosmeticIndex;
      const selectors = [];

      if (Array.isArray(index)) {
        // cosmeticIndex is a flat array of {selector, domains?, excludedDomains?}
        const domainPart = hostname.replace(/^www\./, '');
        for (const entry of index) {
          if (!entry || !entry.selector) continue;
          const doms = entry.domains;
          const excl = entry.excludedDomains;
          // If domains specified, only apply when current site matches
          if (doms && doms.length > 0) {
            const matches = doms.some(d => domainPart === d || domainPart.endsWith('.' + d));
            if (!matches) continue;
          }
          // If excluded domains, skip when current site matches
          if (excl && excl.length > 0) {
            const excluded = excl.some(d => domainPart === d || domainPart.endsWith('.' + d));
            if (excluded) continue;
          }
          selectors.push(entry.selector);
        }
      } else if (typeof index === 'object') {
        // cosmeticIndex is domain-keyed: { "example.com": ["sel1", "sel2"] }
        const parts = hostname.split('.');
        for (let i = 0; i < parts.length - 1; i++) {
          const domain = parts.slice(i).join('.');
          if (index[domain]) {
            selectors.push(...index[domain]);
          }
        }
      }

      if (selectors.length === 0) return;
      // Inject as a separate style element
      const compiledStyleId = 'shadowblock-compiled-cosmetic';
      if (document.getElementById(compiledStyleId)) return;
      const style = document.createElement('style');
      style.id = compiledStyleId;
      style.textContent = selectors.map(s => s + '{display:none!important;visibility:hidden!important;height:0!important;overflow:hidden!important;}').join('\n');
      (document.head || document.documentElement).appendChild(style);
    });
  }

  // Load compiled selectors once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCompiledSelectors);
  } else {
    loadCompiledSelectors();
  }
})();
