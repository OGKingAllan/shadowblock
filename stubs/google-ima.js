// ShadowBlock surrogate: Google IMA SDK v3
// Based on uBlock Origin's google-ima.js approach
(function() {
  'use strict';
  if (!window.google) window.google = {};
  if (!window.google.ima) window.google.ima = {};
  const ima = window.google.ima;

  class EventHandler {
    constructor() { this._listeners = new Map(); }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }
    _dispatch(event) {
      const type = event?.type || event;
      const fns = this._listeners.get(type);
      if (fns) fns.forEach(fn => { try { fn(event); } catch(_) {} });
    }
  }

  const noopfn = function() {};

  ima.AdDisplayContainer = function(containerEl) {
    if (containerEl) {
      const div = document.createElement('div');
      div.style.cssText = 'display:none!important;visibility:collapse!important';
      containerEl.appendChild(div);
    }
    this.initialize = noopfn;
    this.destroy = noopfn;
  };

  ima.AdError = function(msg, code, type) {
    this.getMessage = () => msg || '';
    this.getErrorCode = () => code || 0;
    this.getType = () => type || '';
    this.getVastErrorCode = () => -1;
    this.toString = () => `AdError: ${msg}`;
  };

  ima.AdErrorEvent = { Type: { AD_ERROR: 'adError' } };
  ima.AdEvent = {
    Type: {
      AD_BREAK_READY: 'adBreakReady',
      AD_BUFFERING: 'adBuffering',
      AD_CAN_PLAY: 'adCanPlay',
      AD_METADATA: 'adMetadata',
      ALL_ADS_COMPLETED: 'allAdsCompleted',
      CLICK: 'click',
      COMPLETE: 'complete',
      CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
      CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
      DURATION_CHANGE: 'durationChange',
      FIRST_QUARTILE: 'firstQuartile',
      IMPRESSION: 'impression',
      INTERACTION: 'interaction',
      LINEAR_CHANGED: 'linearChanged',
      LOADED: 'loaded',
      LOG: 'log',
      MIDPOINT: 'midpoint',
      PAUSED: 'pause',
      RESUMED: 'resume',
      SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
      SKIPPED: 'skip',
      STARTED: 'start',
      THIRD_QUARTILE: 'thirdQuartile',
      USER_CLOSE: 'userClose',
      VIDEO_CLICKED: 'videoClicked',
      VOLUME_CHANGED: 'volumeChanged',
      VOLUME_MUTED: 'volumeMuted',
    }
  };

  ima.AdsLoader = class extends EventHandler {
    constructor() { super(); this.settings = new ima.ImaSdkSettings(); }
    contentComplete() {}
    destroy() {}
    getSettings() { return this.settings; }
    requestAds() {
      const self = this;
      requestAnimationFrame(() => {
        self._dispatch({
          type: ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
          getAdsManager: () => new ima.AdsManager(),
          getUserRequestContext: () => null,
        });
        requestAnimationFrame(() => {
          self._dispatch({
            type: ima.AdErrorEvent.Type.AD_ERROR,
            getError: () => new ima.AdError('Browser prevented ad playback', 1205, 'adLoadError'),
            getUserRequestContext: () => null,
          });
        });
      });
    }
  };

  ima.AdsManager = class extends EventHandler {
    constructor() { super(); this._volume = 1; }
    collapse() {}
    configureAdsManager() {}
    destroy() {}
    discardAdBreak() {}
    expand() {}
    focus() {}
    getAdSkippableState() { return false; }
    getCuePoints() { return []; }
    getCurrentAd() { return new ima.Ad(); }
    getCurrentAdCuePoints() { return []; }
    getRemainingTime() { return 0; }
    getVolume() { return this._volume; }
    init(w, h, mode) {}
    isCustomClickTrackingUsed() { return false; }
    isCustomPlaybackUsed() { return false; }
    pause() {}
    requestNextAdBreak() {}
    resize(w, h, mode) {}
    resume() {}
    setVolume(v) { this._volume = v; }
    skip() {}
    start() {
      const self = this;
      requestAnimationFrame(() => {
        self._dispatch({ type: ima.AdEvent.Type.CONTENT_RESUME_REQUESTED });
        self._dispatch({ type: ima.AdEvent.Type.ALL_ADS_COMPLETED });
      });
    }
    stop() {}
    updateAdsRenderingSettings(s) {}
  };

  ima.Ad = class {
    getAdId() { return ''; }
    getAdPodInfo() { return new ima.AdPodInfo(); }
    getAdSystem() { return ''; }
    getAdvertiserName() { return ''; }
    getApiFramework() { return null; }
    getCompanionAds() { return []; }
    getContentType() { return ''; }
    getCreativeAdId() { return ''; }
    getCreativeId() { return ''; }
    getDealId() { return ''; }
    getDescription() { return ''; }
    getDuration() { return 0; }
    getHeight() { return 0; }
    getMediaUrl() { return null; }
    getMinSuggestedDuration() { return 0; }
    getSkipTimeOffset() { return -1; }
    getSurveyUrl() { return null; }
    getTitle() { return ''; }
    getTraffickingParametersString() { return ''; }
    getUiElements() { return []; }
    getUniversalAdIdRegistry() { return 'unknown'; }
    getUniversalAdIds() { return [{ adIdRegistry: 'unknown', adIdValue: 'unknown' }]; }
    getUniversalAdIdValue() { return 'unknown'; }
    getVastMediaBitrate() { return 0; }
    getVastMediaHeight() { return 0; }
    getVastMediaWidth() { return 0; }
    getWidth() { return 0; }
    getWrapperAdIds() { return []; }
    getWrapperAdSystems() { return []; }
    getWrapperCreativeIds() { return []; }
    isLinear() { return true; }
    isSkippable() { return false; }
  };

  ima.AdPodInfo = class {
    getAdPosition() { return 1; }
    getIsBumper() { return false; }
    getMaxDuration() { return -1; }
    getPodIndex() { return 1; }
    getTimeOffset() { return 0; }
    getTotalAds() { return 1; }
  };

  ima.AdsManagerLoadedEvent = { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } };
  ima.AdsRenderingSettings = function() {};
  ima.AdsRequest = function() {};
  ima.CompanionAdSelectionSettings = { CreativeType: { ALL: 'All', FLASH: 'Flash', IMAGE: 'Image' }, ResourceType: { ALL: 'All', FLASH: 'Flash', HTML: 'Html', IFRAME: 'IFrame', IMAGE: 'Image', STATIC: 'Static' }, SizeCriteria: { IGNORE: 'IgnoreSize', SELECT_EXACT_MATCH: 'SelectExactMatch', SELECT_NEAR_MATCH: 'SelectNearMatch' } };
  ima.ImaSdkSettings = class {
    constructor() { this._locale = 'en'; this._vpaidMode = 1; this._autoPlay = true; }
    getCompanionBackfill() { return 'always'; }
    getDisableCustomPlaybackForIOS10Plus() { return false; }
    getDisableFlashAds() { return true; }
    getFeatureFlags() { return {}; }
    getLocale() { return this._locale; }
    getNumRedirects() { return 10; }
    getPlayerType() { return 'Unknown'; }
    getPlayerVersion() { return '0'; }
    getPpid() { return null; }
    isCookiesEnabled() { return true; }
    isVpaidAdapter() { return false; }
    setAutoPlayAdBreaks(v) { this._autoPlay = v; }
    setCompanionBackfill() {}
    setCookiesEnabled() {}
    setDisableCustomPlaybackForIOS10Plus() {}
    setDisableFlashAds() {}
    setFeatureFlags() {}
    setLocale(v) { this._locale = v; }
    setNumRedirects() {}
    setPlayerType() {}
    setPlayerVersion() {}
    setPpid() {}
    setSessionId() {}
    setStreamCorrelator() {}
    setVpaidAllowed() {}
    setVpaidMode(v) { this._vpaidMode = v; }
  };
  ima.ImaSdkSettings.CompanionBackfillMode = { ALWAYS: 'always', ON_MASTER_AD: 'onMasterAd' };
  ima.ImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };
  ima.OmidAccessMode = { DOMAIN: 'domain', FULL: 'full', LIMITED: 'limited' };
  ima.OmidVerificationVendor = { DOUBLE_VERIFY: 7, GOOGLE: 9, INTEGRAL_AD_SCIENCE: 3, MOAT: 2, OTHER: 1, PIXELATE: 4 };
  ima.UiElements = { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' };
  ima.UniversalAdIdInfo = class { getAdIdRegistry() { return ''; } getAdIdValue() { return ''; } };
  ima.ViewMode = { FULLSCREEN: 'fullscreen', NORMAL: 'normal' };
  ima.VERSION = '3.0.0';

  ima.dai = ima.dai || {};
  ima.dai.api = ima.dai.api || {};
  ima.dai.api.StreamManager = class extends EventHandler { constructor() { super(); } };
  ima.dai.api.StreamRequest = function() {};
  ima.dai.api.StreamType = { LIVE: 'live', VOD: 'vod' };
  ima.dai.api.Ad = ima.Ad;
})();
