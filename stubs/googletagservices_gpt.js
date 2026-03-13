// ShadowBlock surrogate: googletagservices/gpt.js
(function() {
  'use strict';
  const noopfn = function() {};
  const noopthis = function() { return this; };
  const slot = {
    addService: noopthis, clearCategoryExclusions: noopthis,
    clearTargeting: noopthis, defineSizeMapping: noopthis,
    get: function() { return null; }, getAdUnitPath: noopfn,
    getAttributeKeys: function() { return []; },
    getCategoryExclusions: function() { return []; },
    getDomId: noopfn, getResponseInformation: function() { return null; },
    getSlotElementId: noopfn, getSlotId: noopfn,
    getTargeting: function() { return []; },
    getTargetingKeys: function() { return []; },
    set: noopthis, setCategoryExclusion: noopthis,
    setClickUrl: noopthis, setCollapseEmptyDiv: noopthis,
    setForceSafeFrame: noopthis, setSafeFrameConfig: noopthis,
    setTargeting: noopthis, updateTargetingFromMap: noopthis
  };
  const sizeMapping = { addSize: noopthis, build: function() { return []; } };
  const pubads = {
    addEventListener: noopthis, clear: noopfn, clearCategoryExclusions: noopthis,
    clearTagForChildDirectedTreatment: noopthis, clearTargeting: noopthis,
    collapseEmptyDivs: noopfn, defineOutOfPagePassback: function() { return slot; },
    definePassback: function() { return slot; }, disableInitialLoad: noopfn,
    display: noopfn, enableAsyncRendering: noopfn, enableSingleRequest: noopfn,
    enableSyncRendering: noopfn, enableVideoAds: noopfn,
    get: function() { return null; }, getAttributeKeys: function() { return []; },
    getCorrelator: noopfn, getSlots: function() { return []; },
    getTargeting: function() { return []; },
    getTargetingKeys: function() { return []; },
    refresh: noopfn, set: noopthis, setCategoryExclusion: noopthis,
    setCentering: noopfn, setCookieOptions: noopthis,
    setForceSafeFrame: noopthis, setLocation: noopthis,
    setPublisherProvidedId: noopthis, setRequestNonPersonalizedAds: noopthis,
    setSafeFrameConfig: noopthis, setTagForChildDirectedTreatment: noopthis,
    setTargeting: noopthis, setVideoContent: noopthis,
    updateCorrelator: noopfn
  };
  const companionAds = { addEventListener: noopthis, enableSyncLoading: noopfn, setRefreshUnfilledSlots: noopfn };
  const content = { addEventListener: noopthis, setContent: noopfn };
  window.googletag = window.googletag || {};
  const gt = window.googletag;
  gt.apiReady = true;
  gt.cmd = gt.cmd || [];
  gt.cmd.push = function(fn) { try { fn(); } catch(e) {} return 1; };
  gt.companionAds = function() { return companionAds; };
  gt.content = function() { return content; };
  gt.defineSlot = function() { return slot; };
  gt.defineOutOfPageSlot = function() { return slot; };
  gt.destroySlots = noopfn;
  gt.disablePublisherConsole = noopfn;
  gt.display = noopfn;
  gt.enableServices = noopfn;
  gt.getVersion = function() { return '0'; };
  gt.pubads = function() { return pubads; };
  gt.pubadsReady = true;
  gt.setAdIframeTitle = noopfn;
  gt.sizeMapping = function() { return sizeMapping; };
  const q = gt.cmd.slice ? gt.cmd.slice() : [];
  gt.cmd.length = 0;
  for (const fn of q) { try { fn(); } catch(e) {} }
})();
