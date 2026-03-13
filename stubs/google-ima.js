// ShadowBlock surrogate: google-ima (IMA SDK for video ads)
(function() {
  'use strict';
  const noopfn = function() {};
  if (!window.google) window.google = {};
  if (!window.google.ima) window.google.ima = {};
  const ima = window.google.ima;
  ima.AdDisplayContainer = function(el) { this.initialize = noopfn; this.destroy = noopfn; };
  ima.AdError = function(msg, code, type) { this.getMessage = function() { return msg || ''; }; this.getErrorCode = function() { return code || 0; }; this.getType = function() { return type || ''; }; };
  ima.AdErrorEvent = { Type: { AD_ERROR: 'adError' } };
  ima.AdEvent = { Type: { CONTENT_RESUME_REQUESTED: 'contentResumeRequested', CONTENT_PAUSE_REQUESTED: 'contentPauseRequested', LOADED: 'loaded', ALL_ADS_COMPLETED: 'allAdsCompleted' } };
  ima.AdsLoader = function() {
    this.addEventListener = noopfn; this.removeEventListener = noopfn;
    this.contentComplete = noopfn; this.destroy = noopfn;
    this.getSettings = function() { return { setVpaidMode: noopfn, setLocale: noopfn, setPlayerType: noopfn, setPlayerVersion: noopfn, setAutoPlayAdBreaks: noopfn }; };
    this.requestAds = function() {
      const e = new ima.AdError('No ads', 1009, 'adLoadError');
      const ev = { type: 'adError', getError: function() { return e; } };
      if (this._errHandler) this._errHandler(ev);
    };
  };
  ima.AdsManagerLoadedEvent = { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } };
  ima.AdsRenderingSettings = function() {};
  ima.CompanionAdSelectionSettings = { CreativeType: {ALL: 'All'}, ResourceType: {ALL: 'All'}, SizeCriteria: {IGNORE: 'IgnoreSize'} };
  ima.ImaSdkSettings = function() {};
  ima.ImaSdkSettings.CompanionBackfillMode = { ALWAYS: 'always' };
  ima.ImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };
  ima.OmidAccessMode = { DOMAIN: 'domain', FULL: 'full', LIMITED: 'limited' };
  ima.ViewMode = { FULLSCREEN: 'fullscreen', NORMAL: 'normal' };
  ima.VERSION = '3.0.0';
})();
