// ShadowBlock surrogate: google-analytics/analytics.js
(function() {
  'use strict';
  const noopfn = function() {};
  const Tracker = function() {};
  Tracker.prototype = {
    get: noopfn, set: noopfn, send: noopfn,
    _initData: noopfn, _trackPageview: noopfn
  };
  const ga = function() {
    const args = [].slice.call(arguments);
    if (args.length === 0) return;
    const cmd = typeof args[0] === 'string' ? args[0] : '';
    if (cmd === 'create') return new Tracker();
    const cb = args[args.length - 1];
    if (typeof cb === 'function') { try { cb(new Tracker()); } catch(e) {} }
  };
  ga.create = function() { return new Tracker(); };
  ga.getByName = function() { return new Tracker(); };
  ga.getAll = function() { return [new Tracker()]; };
  ga.loaded = true;
  window.ga = ga;
  window.GoogleAnalyticsObject = 'ga';
})();
