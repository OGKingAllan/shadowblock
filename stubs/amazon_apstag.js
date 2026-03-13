// ShadowBlock surrogate: amazon/apstag.js
(function() {
  'use strict';
  const noopfn = function() {};
  window.apstag = {
    init: noopfn,
    fetchBids: function(cfg, cb) { if (typeof cb === 'function') cb([]); },
    setDisplayBids: noopfn, targetingKeys: noopfn,
    _Q: [], _getSlotIdToNameMapping: function() { return {}; },
    renderImp: noopfn, debug: noopfn
  };
})();
