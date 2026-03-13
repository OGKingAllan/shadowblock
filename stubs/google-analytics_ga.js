// ShadowBlock surrogate: google-analytics/ga.js (legacy)
(function() {
  'use strict';
  const noopfn = function() {};
  window._gaq = { push: noopfn, _getAsyncTracker: noopfn };
  window._gat = {
    _getTracker: function() {
      return {
        _trackPageview: noopfn, _trackEvent: noopfn,
        _trackSocial: noopfn, _trackTiming: noopfn,
        _setCustomVar: noopfn, _setVar: noopfn,
        _setAccount: noopfn, _setDomainName: noopfn,
        _getLinkerUrl: function(url) { return url; }
      };
    },
    _createTracker: noopfn, _getTrackerByName: noopfn
  };
})();
