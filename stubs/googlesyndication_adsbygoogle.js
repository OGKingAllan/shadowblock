// ShadowBlock surrogate: googlesyndication/adsbygoogle.js
(function() {
  'use strict';
  const p = new Proxy([], {
    get(target, prop) {
      if (prop === 'length') return 0;
      if (prop === 'loaded') return true;
      if (prop === 'push') return function() {};
      return target[prop];
    }
  });
  window.adsbygoogle = p;
})();
