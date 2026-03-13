/**
 * ShadowBlock — YouTube Ad Blocker Module
 *
 * Deep integration with YouTube to block all ad types:
 * pre-roll, mid-roll, post-roll, overlay, display, sponsored cards,
 * homepage promoted, search ads, masthead, Shorts ads, Premium upsells,
 * survey prompts, and pause-screen ads.
 *
 * Injected at document_start on youtube.com and youtube-nocookie.com.
 * Operates in both content script context (DOM) and page context (API interception).
 */

(() => {
  'use strict';

  if (window.__shadowblock_yt_active) return;
  window.__shadowblock_yt_active = true;

  const _intervals = [];

  // ---------------------------------------------------------------------------
  // 1. CSS PRE-HIDE — injected immediately at document_start to prevent flash
  // ---------------------------------------------------------------------------
  const CSS_RULES = `
    /* Video ad overlays and containers */
    .video-ads,
    .ytp-ad-module,
    .ytp-ad-overlay-container,
    .ytp-ad-text-overlay,
    .ytp-ad-overlay-slot,
    .ytp-ad-overlay-image,
    .ytp-ad-player-overlay,
    .ytp-ad-player-overlay-instream-info,
    .ytp-ad-action-interstitial,
    .ytp-ad-action-interstitial-background-container,
    .ytp-ad-image-overlay,
    .ytp-ad-skip-ad-slot,
    .ytp-ad-preview-container,
    .ytp-ad-message-container,
    .ytp-ad-persistent-progress-bar-container,
    .ytp-ad-visit-advertiser-button,
    .ytp-ad-feedback-dialog-renderer,
    #player-ads,
    #masthead-ad,
    #masthead-container:has(ytd-primetime-promo-renderer),

    /* Renderer-based ad elements */
    ytd-ad-slot-renderer,
    ytd-banner-promo-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer,
    ytd-display-ad-renderer,
    ytd-statement-banner-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-rich-item-renderer:has(.ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-ad-slot-renderer),
    ytd-reel-video-renderer:has(.ytd-ad-slot-renderer),
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-action-companion-ad-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-primetime-promo-renderer,

    /* Premium upsell and survey prompts */
    tp-yt-paper-dialog:has(yt-mealbar-promo-renderer),
    ytd-popup-container:has(yt-mealbar-promo-renderer),
    ytd-mealbar-promo-renderer,
    yt-mealbar-promo-renderer,
    ytmusic-mealbar-promo-renderer,
    .yt-mealbar-promo-renderer,

    /* Survey / feedback overlays */
    .ytp-ad-survey,
    .ytp-ad-feedback-dialog-background-container,
    ytd-enforcement-message-view-model,

    /* Pause screen ads */
    .ytp-pause-overlay-container,
    .ytp-pause-overlay,

    /* Sidebar companion ads */
    #companion,
    #companion-slot,
    ytd-companion-slot-renderer,

    /* Search result ads */
    ytd-search-pyv-renderer,

    /* Movie offers / upsells */
    ytd-movie-offer-module-renderer,

    /* Merch shelf */
    ytd-merch-shelf-renderer,

    /* Ticket shelf */
    ytd-ticket-shelf-renderer,

    /* Info panels that are ads */
    .ytd-promoted-sparkles-web-renderer,

    /* Shorts ads */
    ytd-reel-video-renderer[is-ad],
    ytd-ad-slot-renderer[data-is-shorts-ad] {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }

    /* Hide the ad badge indicators */
    .ytp-ad-badge,
    .ytp-ad-badge-text,
    .badge-style-type-ad,
    .ytd-badge-supported-renderer[aria-label="Ad"] {
      display: none !important;
    }

    /* Collapse empty ad containers */
    #related:has(> ytd-ad-slot-renderer:only-child),
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer):empty {
      display: none !important;
    }
  `;

  function injectCSS() {
    const style = document.createElement('style');
    style.id = 'shadowblock-yt-css';
    style.textContent = CSS_RULES;
    (document.head || document.documentElement).appendChild(style);
  }

  // Inject CSS immediately — before DOM is built
  injectCSS();

  // ---------------------------------------------------------------------------
  // 2. PAGE-CONTEXT SCRIPT INJECTION — for API interception
  // ---------------------------------------------------------------------------
  // This script runs in the page's JS context (not the content script sandbox)
  // so it can intercept YouTube's internal objects and network requests.

  const PAGE_SCRIPT = `
  (() => {
    'use strict';
    if (window.__shadowblock_yt_page_active) return;
    window.__shadowblock_yt_page_active = true;

    // -----------------------------------------------------------------------
    // 2a. JSON pruning — strip ad properties from player responses
    // -----------------------------------------------------------------------
    const AD_PROPERTIES = [
      'adPlacements',
      'playerAds',
      'adSlots',
      'adBreakParams',
      'adBreakHeartbeatParams',
      'adSurveyResponses',
      'advertisedVideo',
      'adLayoutLoggingData',
      'instreamAdPlayerOverlayRenderer',
      'linearAdSequenceRenderer',
      'adPlacementConfig',
      'adVideoId',
      'playerLegacyDesktopWatchAdsRenderer',
      'actionCompanionAdRenderer',
    ];

    function pruneAdData(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) {
        return obj.map(pruneAdData);
      }
      for (const key of AD_PROPERTIES) {
        if (key in obj) {
          delete obj[key];
        }
      }
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          pruneAdData(obj[key]);
        }
      }
      return obj;
    }

    // -----------------------------------------------------------------------
    // 2b. Intercept ytInitialPlayerResponse before YouTube reads it
    // -----------------------------------------------------------------------
    function interceptInitialData() {
      // Override the property so we can prune before YouTube's code reads it
      const props = [
        'ytInitialPlayerResponse',
        'ytInitialData',
      ];

      for (const prop of props) {
        let _value = window[prop];
        if (_value) {
          pruneAdData(_value);
        }
        try {
          Object.defineProperty(window, prop, {
            configurable: true,
            get() { return _value; },
            set(v) {
              _value = pruneAdData(v);
            },
          });
        } catch (e) {
          // Property may already be defined; try wrapping
        }
      }
    }
    interceptInitialData();

    // -----------------------------------------------------------------------
    // 2c. Intercept fetch() for player API and ad stats
    // -----------------------------------------------------------------------
    const _origFetch = window.fetch;
    window.fetch = function(resource, init) {
      const url = (typeof resource === 'string') ? resource
                : (resource instanceof Request) ? resource.url
                : '';

      // Block ad stats/tracking requests entirely
      if (/\\/api\\/stats\\/ads/.test(url) ||
          /\\/api\\/stats\\/atr/.test(url) ||
          /\\/pagead\\//.test(url) ||
          /\\/ptracking/.test(url) ||
          /doubleclick\\.net/.test(url) ||
          /googlesyndication\\.com/.test(url) ||
          /googleads\\.g\\.doubleclick/.test(url) ||
          /\\/get_midroll_/.test(url)) {
        return Promise.resolve(new Response('', { status: 200 })); // Resolve immediately with empty response
      }

      // For player API: intercept and prune ad data from response
      if (/\\/youtubei\\/v1\\/player/.test(url) ||
          /\\/youtubei\\/v1\\/next/.test(url)) {
        return _origFetch.apply(this, arguments).then(response => {
          const clone = response.clone();
          return clone.json().then(data => {
            pruneAdData(data);
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }).catch(() => response);
        });
      }

      return _origFetch.apply(this, arguments);
    };

    // -----------------------------------------------------------------------
    // 2d. Intercept XMLHttpRequest for ad requests
    // -----------------------------------------------------------------------
    const _origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      const urlStr = String(url);
      if (/\\/api\\/stats\\/ads/.test(urlStr) ||
          /\\/api\\/stats\\/atr/.test(urlStr) ||
          /\\/pagead\\//.test(urlStr) ||
          /\\/ptracking/.test(urlStr) ||
          /doubleclick\\.net/.test(urlStr) ||
          /googlesyndication\\.com/.test(urlStr) ||
          /\\/get_midroll_/.test(urlStr)) {
        // Redirect to a no-op URL
        arguments[1] = 'data:application/json,{}';
      }
      return _origXHROpen.apply(this, arguments);
    };

    // -----------------------------------------------------------------------
    // 2e. Hook into ytplayer.config to strip ad flags
    // -----------------------------------------------------------------------
    function patchPlayerConfig() {
      try {
        if (window.yt && window.yt.config_) {
          // Disable ad-related flags
          const flagsToDisable = [
            'ENABLE_PREROLL', 'ENABLE_MIDROLL', 'ENABLE_POSTROLL',
            'AD_ADVANCEMENT_ENABLED', 'DISABLE_AD_ADVANCEMENT',
          ];
          for (const flag of flagsToDisable) {
            if (flag in window.yt.config_) {
              window.yt.config_[flag] = false;
            }
          }
        }
        if (window.ytplayer && window.ytplayer.config) {
          pruneAdData(window.ytplayer.config);
          if (window.ytplayer.config.args) {
            pruneAdData(window.ytplayer.config.args);
            // Remove serialized ad data
            const adArgs = ['ad_tag', 'ad_preroll', 'ad3_module', 'ad_flags'];
            for (const arg of adArgs) {
              delete window.ytplayer.config.args[arg];
            }
          }
        }
      } catch (e) {}
    }

    // -----------------------------------------------------------------------
    // 2f. Intercept JSON.parse to prune ad data in transit
    // -----------------------------------------------------------------------
    const _origJSONParse = JSON.parse;
    JSON.parse = function() {
      const result = _origJSONParse.apply(this, arguments);
      if (result && typeof result === 'object') {
        // Only prune objects that look like YouTube player responses
        if (result.adPlacements || result.playerAds || result.adSlots ||
            result.adBreakParams) {
          pruneAdData(result);
        }
      }
      return result;
    };

    // -----------------------------------------------------------------------
    // 2g. Periodically patch player config (self-healing)
    // -----------------------------------------------------------------------
    setInterval(patchPlayerConfig, 2000);

    // Dispatch event so content script knows page script is ready
    window.dispatchEvent(new CustomEvent('shadowblock-yt-page-ready'));
  })();
  `;

  function injectPageScript() {
    const script = document.createElement('script');
    script.textContent = PAGE_SCRIPT;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // Clean up — the code already executed
  }

  // Inject page script immediately
  injectPageScript();

  // ---------------------------------------------------------------------------
  // 3. VIDEO AD SKIPPER — content script context
  // ---------------------------------------------------------------------------

  const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button-container',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container',
    // "Skip in X seconds" becomes "Skip Ad" — click when clickable
    'button[class*="skip"]',
  ];

  const AD_PLAYING_INDICATORS = [
    '.ad-showing',
    '.ad-interrupting',
    '.ytp-ad-player-overlay',
    '.ytp-ad-player-overlay-instream-info',
  ];

  function isAdPlaying() {
    // Check player container for ad-showing class
    const player = document.querySelector('.html5-video-player');
    if (player && (player.classList.contains('ad-showing') ||
                   player.classList.contains('ad-interrupting'))) {
      return true;
    }
    // Fallback: check for ad overlay elements
    for (const sel of AD_PLAYING_INDICATORS) {
      if (document.querySelector(sel)) return true;
    }
    return false;
  }

  function trySkipAd() {
    for (const sel of SKIP_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  // Track whether user had video muted before ad started
  let _userMutedBeforeAd = false;

  // Cached video element reference — re-query only when disconnected
  let _cachedVideo = null;

  function getVideoElement() {
    if (_cachedVideo && _cachedVideo.isConnected) return _cachedVideo;
    _cachedVideo = document.querySelector('video.html5-main-video') ||
                   document.querySelector('.html5-video-player video');
    return _cachedVideo;
  }

  function speedUpOrSkipVideoAd() {
    if (!isAdPlaying()) return;

    // First try to click skip button
    if (trySkipAd()) return;

    // Get the video element (cached)
    const video = getVideoElement();
    if (!video) return;

    if (video.playbackRate < 16) {
      _userMutedBeforeAd = video.muted;
      video.playbackRate = 16;
    }

    if (video.duration && isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.max(video.duration - 0.1, 0);
    }

    video.muted = true;
  }

  function restoreAfterAd() {
    const video = getVideoElement();
    if (!video) return;

    // Restore normal playback rate if ad ended
    if (!isAdPlaying() && video.playbackRate > 2) {
      video.playbackRate = 1;
      video.muted = _userMutedBeforeAd;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. DOM MUTATION OBSERVER — watch for ad elements being inserted
  // ---------------------------------------------------------------------------

  const AD_ELEMENT_SELECTORS = [
    'ytd-ad-slot-renderer',
    'ytd-banner-promo-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer',
    'ytd-primetime-promo-renderer',
    'ytd-mealbar-promo-renderer',
    'yt-mealbar-promo-renderer',
    'ytd-enforcement-message-view-model',
    'ytd-search-pyv-renderer',
    'ytd-movie-offer-module-renderer',
    'ytd-companion-slot-renderer',
    'ytd-rich-item-renderer[is-peek-preview-ad]',
  ];

  const AD_CLASS_PATTERNS = [
    'ytp-ad-module',
    'ytp-ad-overlay-container',
    'ytp-ad-text-overlay',
    'ytp-ad-image-overlay',
    'ytp-ad-player-overlay',
    'ytp-ad-survey',
    'ytp-ad-feedback-dialog',
    'ytp-pause-overlay-container',
    'video-ads',
  ];

  const AD_ID_PATTERNS = [
    'player-ads',
    'masthead-ad',
    'companion',
    'companion-slot',
  ];

  function removeElement(el) {
    if (el && el.parentNode) {
      el.remove();
    }
  }

  function isAdElement(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();
    const classList = node.classList;
    const id = node.id;

    // Check tag name
    for (const sel of AD_ELEMENT_SELECTORS) {
      // Handle attribute selectors
      const bracketIdx = sel.indexOf('[');
      const tagPart = bracketIdx > -1 ? sel.substring(0, bracketIdx) : sel;
      if (tag === tagPart.toLowerCase()) return true;
    }

    // Check classes
    if (classList) {
      for (const pattern of AD_CLASS_PATTERNS) {
        if (classList.contains(pattern)) return true;
      }
    }

    // Check IDs
    if (id) {
      for (const pattern of AD_ID_PATTERNS) {
        if (id === pattern) return true;
      }
    }

    // Check for ad data attributes
    if (node.hasAttribute('is-ad') ||
        node.hasAttribute('data-is-ad') ||
        node.getAttribute('target-id') === 'engagement-panel-ads') {
      return true;
    }

    return false;
  }

  function purgeExistingAds() {
    // Remove all currently-present ad elements
    const allSelectors = [
      ...AD_ELEMENT_SELECTORS,
      ...AD_CLASS_PATTERNS.map(c => '.' + c),
      ...AD_ID_PATTERNS.map(id => '#' + id),
      '[target-id="engagement-panel-ads"]',
      'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
      'tp-yt-paper-dialog:has(ytd-popup-container)',
    ];

    for (const sel of allSelectors) {
      try {
        document.querySelectorAll(sel).forEach(removeElement);
      } catch (e) {
        // :has() may not be supported in all contexts; ignore
      }
    }
  }

  // Set up MutationObserver
  let observer = null;

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      let adDetected = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (isAdElement(node)) {
            removeElement(node);
            adDetected = true;
            continue;
          }
          // Also check children of added nodes
          if (node.nodeType === Node.ELEMENT_NODE && node.querySelectorAll) {
            const allSelectors = AD_ELEMENT_SELECTORS.join(',');
            try {
              node.querySelectorAll(allSelectors).forEach(el => {
                removeElement(el);
                adDetected = true;
              });
            } catch (e) {}
          }
        }

        // Check attribute changes on the player (ad-showing class)
        if (mutation.type === 'attributes' &&
            mutation.attributeName === 'class' &&
            mutation.target.classList) {
          if (mutation.target.classList.contains('ad-showing') ||
              mutation.target.classList.contains('ad-interrupting')) {
            adDetected = true;
          }
        }
      }

      if (adDetected) {
        speedUpOrSkipVideoAd();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  // ---------------------------------------------------------------------------
  // 5. SPA NAVIGATION HANDLER — re-apply on YouTube soft navigation
  // ---------------------------------------------------------------------------

  let lastUrl = location.href;

  function onNavigate() {
    // Re-inject CSS if it got removed
    if (!document.getElementById('shadowblock-yt-css')) {
      injectCSS();
    }

    // Purge ads on the new page
    purgeExistingAds();

    // Restart observer if needed
    startObserver();

    // Restore playback rate if leftover from ad skip
    restoreAfterAd();
  }

  // Listen for YouTube's SPA navigation event
  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('yt-navigate-start', () => {
    // Reset playback rate preemptively
    restoreAfterAd();
  });

  // Also monitor URL changes via popstate and polling
  window.addEventListener('popstate', onNavigate);

  _intervals.push(setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate();
    }
  }, 1000));

  // ---------------------------------------------------------------------------
  // 6. AD POLLING LOOP — aggressive check for video ads
  // ---------------------------------------------------------------------------

  // Fast poll during ads, slow poll otherwise
  let adPollInterval = null;
  let adWasPlaying = false;

  function adPollTick() {
    const adNow = isAdPlaying();

    if (adNow) {
      speedUpOrSkipVideoAd();
      if (!adWasPlaying) {
        adWasPlaying = true;
        clearInterval(adPollInterval);
        adPollInterval = setInterval(adPollTick, 100);
        _intervals.push(adPollInterval);
      }
    } else {
      if (adWasPlaying) {
        adWasPlaying = false;
        restoreAfterAd();
        clearInterval(adPollInterval);
        adPollInterval = setInterval(adPollTick, 1000);
        _intervals.push(adPollInterval);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 7. SELF-HEALING — re-apply if YouTube removes our modifications
  // ---------------------------------------------------------------------------

  function selfHeal() {
    // Re-inject CSS if removed
    if (!document.getElementById('shadowblock-yt-css')) {
      injectCSS();
    }

    // Re-purge any ad elements that slipped through
    purgeExistingAds();

    // Ensure observer is still running
    if (!observer) {
      startObserver();
    }
  }

  // ---------------------------------------------------------------------------
  // 8. INITIALIZATION
  // ---------------------------------------------------------------------------

  function init() {
    // Start MutationObserver
    startObserver();

    // Initial purge of any existing ads
    purgeExistingAds();

    adPollInterval = setInterval(adPollTick, 1000);
    _intervals.push(adPollInterval);

    _intervals.push(setInterval(selfHeal, 10000));
  }

  // Run init when DOM is available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---------------------------------------------------------------------------
  // 9. SHORTS AD HANDLER — specific handling for Shorts feed
  // ---------------------------------------------------------------------------

  function handleShortsAds() {
    // Shorts ads use different renderer structure
    const shortsContainer = document.querySelector('ytd-shorts');
    if (!shortsContainer) return;

    const reelItems = shortsContainer.querySelectorAll('ytd-reel-video-renderer');
    for (const reel of reelItems) {
      // Check if this reel is an ad
      if (reel.hasAttribute('is-ad') ||
          reel.querySelector('ytd-ad-slot-renderer') ||
          reel.querySelector('.ytp-ad-module')) {
        removeElement(reel);
      }
    }
  }

  window.addEventListener('yt-navigate-finish', handleShortsAds);
  _intervals.push(setInterval(handleShortsAds, 3000));

  // ---------------------------------------------------------------------------
  // 10. PREMIUM UPSELL / DIALOG BLOCKER
  // ---------------------------------------------------------------------------

  function dismissUpsellDialogs() {
    // Premium upsell modals
    const dialogs = document.querySelectorAll(
      'tp-yt-paper-dialog, ytd-popup-container, yt-confirm-dialog-renderer'
    );
    for (const dialog of dialogs) {
      if (dialog.textContent &&
          (dialog.textContent.includes('YouTube Premium') ||
           dialog.textContent.includes('Try it free') ||
           dialog.textContent.includes('Get Premium') ||
           dialog.textContent.includes('Ad-free') ||
           dialog.textContent.includes('background play'))) {
        // Try to find and click dismiss/close button
        const closeBtn = dialog.querySelector(
          'yt-button-renderer[dialog-dismiss], button[aria-label="Close"], ' +
          '.dismiss-button, yt-icon-button'
        );
        if (closeBtn) {
          closeBtn.click();
        } else {
          removeElement(dialog);
        }
      }
    }

    // "How was this ad?" surveys
    const surveys = document.querySelectorAll(
      '.ytp-ad-survey, .ytp-ad-feedback-dialog-background-container'
    );
    surveys.forEach(removeElement);
  }

  _intervals.push(setInterval(dismissUpsellDialogs, 3000));

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'stateChanged' && !msg.enabled) {
      _intervals.forEach(clearInterval);
      _intervals.length = 0;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }
  });

})();
