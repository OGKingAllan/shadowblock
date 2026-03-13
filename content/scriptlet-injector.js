/**
 * ShadowBlock — Scriptlet Engine (Content Script)
 * Injected at document_start, BEFORE any page scripts run.
 *
 * 37 scriptlets matching uBlock Origin / AdGuard capabilities:
 *   - API Interception (5)
 *   - Timer Manipulation (4)
 *   - DOM Manipulation (4)
 *   - Network/Fetch Interception (4)
 *   - Cookie/Storage (4)
 *   - Anti-Detection / Stealth (7)
 *   - Anti-Adblock Specific (5)
 *   - Layout/Visual Spoofing (4)
 *
 * All scriptlets inject into PAGE context via script element.
 * All overridden natives spoof toString() to return [native code].
 */

(() => {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════
  // SCRIPTLET REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  const SCRIPTLETS = {};

  function registerScriptlet(name, fn) {
    SCRIPTLETS[name] = fn;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS (available inside page context)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shared utility code injected alongside every scriptlet.
   * Provides: spoofToString, matchPattern, walkPath, setPath, BAIT_PATTERNS, isAdBaitElement
   */
  const HELPERS_SRC = `
    // Spoof fn.toString() to look native
    function spoofToString(fn, nativeName) {
      const native = 'function ' + nativeName + '() { [native code] }';
      fn.toString = new Proxy(Function.prototype.toString, {
        apply() { return native; }
      });
      try {
        Object.defineProperty(fn, 'toString', { enumerable: false });
      } catch(_) {}
    }

    // Match a string against a pattern (supports * wildcard and /regex/)
    function matchPattern(str, pattern) {
      if (!pattern || pattern === '*' || pattern === '') return true;
      if (typeof str !== 'string') str = String(str);
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        try { return new RegExp(pattern.slice(1, -1)).test(str); } catch(_) { return false; }
      }
      if (pattern.includes('*')) {
        const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\*/g, '.*') + '$', 'i');
        return re.test(str);
      }
      return str.toLowerCase().includes(pattern.toLowerCase());
    }

    // Walk an object path like "a.b.c" returning { obj, prop } for the final step
    function walkPath(root, path) {
      const parts = path.split('.');
      let obj = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj == null) return null;
        obj = obj[parts[i]];
      }
      if (obj == null) return null;
      return { obj: obj, prop: parts[parts.length - 1] };
    }

    // Set a deep property on an object, creating intermediates
    function setPath(root, path, descriptor) {
      const parts = path.split('.');
      let obj = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in obj)) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      Object.defineProperty(obj, parts[parts.length - 1], descriptor);
    }

    // Resolve special constant values used in set-constant and similar
    function resolveConstant(val) {
      const map = {
        'true': true, 'false': false,
        '0': 0, '1': 1, '-1': -1,
        'undefined': undefined, 'null': null,
        'NaN': NaN, 'Infinity': Infinity,
        'noopFunc': function(){},
        'trueFunc': function(){ return true; },
        'falseFunc': function(){ return false; },
        'throwFunc': function(){ throw new Error(); },
        'noopPromiseResolve': function(){ return Promise.resolve(); },
        'emptyArr': [],
        'emptyObj': {},
        '': '',
      };
      if (val in map) return map[val];
      if (!isNaN(Number(val))) return Number(val);
      return val;
    }

    // Bait element detection patterns
    const BAIT_PATTERNS = [
      /^ad[\\s_-]?banner/i, /^ad[\\s_-]?box/i, /^ad[\\s_-]?container/i,
      /^ad[\\s_-]?slot/i, /^ad[\\s_-]?wrapper/i, /^adsbox/i, /^adblock/i,
      /^ads-banner/i, /^pub_300x250/i, /^textAd/i, /^banner[\\s_-]?ad/i,
      /^sponsor/i, /doubleclick/i, /ad-placeholder/i, /AdSense/i,
      /^google[_-]?ad/i, /^afs_ads/i, /^ad[\\s_-]?unit/i, /^ad[\\s_-]?zone/i,
      /^ad[\\s_-]?label/i, /^ad[\\s_-]?inner/i, /^ad[\\s_-]?frame/i,
    ];

    function isAdBaitElement(el) {
      if (!el || (!el.id && !el.className && !el.getAttribute)) return false;
      const id = el.id || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      const combined = id + ' ' + cls;
      return BAIT_PATTERNS.some(p => p.test(combined));
    }
  `;


  // ═══════════════════════════════════════════════════════════════════════════
  // 1. API INTERCEPTION SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. abort-on-property-read
  registerScriptlet("abort-on-property-read", (args) => {
    const property = args[0];
    if (!property) return;
    return `
      (function() {
        ${HELPERS_SRC}
        const chain = ${JSON.stringify(property)}.split('.');
        if (chain.length === 1) {
          try {
            Object.defineProperty(window, ${JSON.stringify(property)}, {
              get() { throw new ReferenceError(''); },
              set(v) {},
              configurable: true,
            });
          } catch(_) {}
        } else {
          // For chained properties, monitor with a setter trap
          const owner = chain.slice(0, -1).join('.');
          const prop = chain[chain.length - 1];
          function trapProp(obj) {
            if (!obj) return;
            try {
              Object.defineProperty(obj, prop, {
                get() { throw new ReferenceError(''); },
                set(v) {},
                configurable: true,
              });
            } catch(_) {}
          }
          const target = walkPath(window, owner);
          if (target) trapProp(target.obj[target.prop] || target.obj);
          // Also watch for late assignment
          try {
            const parts = owner.split('.');
            let base = window;
            for (let i = 0; i < parts.length - 1; i++) base = base[parts[i]];
            const lastPart = parts[parts.length - 1];
            let currentVal = base[lastPart];
            Object.defineProperty(base, lastPart, {
              get() { return currentVal; },
              set(v) { currentVal = v; if (v && typeof v === 'object') trapProp(v); },
              configurable: true,
            });
          } catch(_) {}
        }
      })();
    `;
  });

  // 2. abort-on-property-write
  registerScriptlet("abort-on-property-write", (args) => {
    const property = args[0];
    if (!property) return;
    return `
      (function() {
        ${HELPERS_SRC}
        try {
          setPath(window, ${JSON.stringify(property)}, {
            get() { return undefined; },
            set(v) { throw new ReferenceError(''); },
            configurable: true,
          });
        } catch(_) {}
      })();
    `;
  });

  // 3. abort-current-inline-script
  registerScriptlet("abort-current-inline-script", (args) => {
    const property = args[0];
    const search = args[1] || "";
    if (!property) return;
    return `
      (function() {
        ${HELPERS_SRC}
        const prop = ${JSON.stringify(property)};
        const needle = ${JSON.stringify(search)};
        const target = walkPath(window, prop);
        if (!target) return;
        const owner = target.obj;
        const key = target.prop;
        const desc = Object.getOwnPropertyDescriptor(owner, key) || { value: owner[key], writable: true, configurable: true };
        let currentValue = desc.value !== undefined ? desc.value : desc.get ? desc.get() : undefined;

        Object.defineProperty(owner, key, {
          get() {
            if (needle) {
              const err = new Error();
              if (err.stack && matchPattern(err.stack, needle)) {
                throw new ReferenceError('');
              }
            } else {
              // If no needle, try to detect inline script
              const err = new Error();
              if (err.stack && /at.*<anonymous>|at.*inline/.test(err.stack)) {
                throw new ReferenceError('');
              }
            }
            return currentValue;
          },
          set(v) { currentValue = v; },
          configurable: true,
        });
      })();
    `;
  });

  // 4. set-constant
  registerScriptlet("set-constant", (args) => {
    const property = args[0];
    const value = args[1] !== undefined ? args[1] : "";
    if (!property) return;
    return `
      (function() {
        ${HELPERS_SRC}
        const resolved = resolveConstant(${JSON.stringify(String(value))});
        try {
          setPath(window, ${JSON.stringify(property)}, {
            get() { return resolved; },
            set() {},
            configurable: true,
          });
        } catch(_) {
          // Fallback: direct assignment
          try {
            const target = walkPath(window, ${JSON.stringify(property)});
            if (target) target.obj[target.prop] = resolved;
          } catch(_) {}
        }
      })();
    `;
  });

  // 5. override-property-read
  registerScriptlet("override-property-read", (args) => {
    const property = args[0];
    const value = args[1] !== undefined ? args[1] : "undefined";
    if (!property) return;
    return `
      (function() {
        ${HELPERS_SRC}
        const resolved = resolveConstant(${JSON.stringify(String(value))});
        try {
          const target = walkPath(window, ${JSON.stringify(property)});
          if (target) {
            const origVal = target.obj[target.prop];
            Object.defineProperty(target.obj, target.prop, {
              get() { return resolved; },
              set(v) {},
              configurable: true,
            });
          }
        } catch(_) {}
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 2. TIMER MANIPULATION SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 6. prevent-setTimeout
  registerScriptlet("prevent-setTimeout", (args) => {
    const needle = args[0] || "";
    const delay = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = window.setTimeout;
        window.setTimeout = function(fn, ms) {
          const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          const needleMatch = matchPattern(fnStr, ${JSON.stringify(needle)});
          const delayMatch = ${JSON.stringify(delay)} === '' || String(ms) === ${JSON.stringify(delay)};
          if (needleMatch && delayMatch) return 0;
          return _orig.apply(this, arguments);
        };
        spoofToString(window.setTimeout, 'setTimeout');
      })();
    `;
  });

  // 7. prevent-setInterval
  registerScriptlet("prevent-setInterval", (args) => {
    const needle = args[0] || "";
    const delay = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = window.setInterval;
        window.setInterval = function(fn, ms) {
          const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          const needleMatch = matchPattern(fnStr, ${JSON.stringify(needle)});
          const delayMatch = ${JSON.stringify(delay)} === '' || String(ms) === ${JSON.stringify(delay)};
          if (needleMatch && delayMatch) return 0;
          return _orig.apply(this, arguments);
        };
        spoofToString(window.setInterval, 'setInterval');
      })();
    `;
  });

  // 8. nano-setTimeout-booster
  registerScriptlet("nano-setTimeout-booster", (args) => {
    const needle = args[0] || "";
    const delayMatch = args[1] || "1000";
    const boostTo = args[2] || "0.02";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = window.setTimeout;
        const threshold = parseInt(${JSON.stringify(delayMatch)}, 10) || 1000;
        const factor = parseFloat(${JSON.stringify(boostTo)}) || 0.02;
        window.setTimeout = function(fn, ms) {
          const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          if (matchPattern(fnStr, ${JSON.stringify(needle)}) && ms >= threshold) {
            return _orig.call(this, fn, Math.round(ms * factor));
          }
          return _orig.apply(this, arguments);
        };
        spoofToString(window.setTimeout, 'setTimeout');
      })();
    `;
  });

  // 9. nano-setInterval-booster
  registerScriptlet("nano-setInterval-booster", (args) => {
    const needle = args[0] || "";
    const delayMatch = args[1] || "1000";
    const boostTo = args[2] || "0.02";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = window.setInterval;
        const threshold = parseInt(${JSON.stringify(delayMatch)}, 10) || 1000;
        const factor = parseFloat(${JSON.stringify(boostTo)}) || 0.02;
        window.setInterval = function(fn, ms) {
          const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          if (matchPattern(fnStr, ${JSON.stringify(needle)}) && ms >= threshold) {
            return _orig.call(this, fn, Math.round(ms * factor));
          }
          return _orig.apply(this, arguments);
        };
        spoofToString(window.setInterval, 'setInterval');
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DOM MANIPULATION SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 10. remove-node-text
  registerScriptlet("remove-node-text", (args) => {
    const nodeName = args[0] || "";
    const textMatch = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const tag = ${JSON.stringify(nodeName)};
        const needle = ${JSON.stringify(textMatch)};
        function scan() {
          const nodes = document.querySelectorAll(tag || '*');
          nodes.forEach(function(node) {
            if (matchPattern(node.textContent, needle)) {
              node.textContent = '';
            }
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scan);
        } else { scan(); }
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
      })();
    `;
  });

  // 11. remove-class
  registerScriptlet("remove-class", (args) => {
    const className = args[0] || "";
    const selector = args[1] || "";
    return `
      (function() {
        const cls = ${JSON.stringify(className)};
        const sel = ${JSON.stringify(selector)} || ('.' + cls);
        function scan() {
          document.querySelectorAll(sel).forEach(function(el) {
            cls.split('|').forEach(function(c) { el.classList.remove(c); });
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scan);
        } else { scan(); }
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      })();
    `;
  });

  // 12. remove-attr
  registerScriptlet("remove-attr", (args) => {
    const attr = args[0] || "";
    const selector = args[1] || "";
    return `
      (function() {
        const attrs = ${JSON.stringify(attr)}.split('|');
        const sel = ${JSON.stringify(selector)} || '*';
        function scan() {
          document.querySelectorAll(sel).forEach(function(el) {
            attrs.forEach(function(a) { el.removeAttribute(a); });
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scan);
        } else { scan(); }
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      })();
    `;
  });

  // 13. set-attr
  registerScriptlet("set-attr", (args) => {
    const selector = args[0] || "";
    const attr = args[1] || "";
    const value = args[2] || "";
    return `
      (function() {
        const sel = ${JSON.stringify(selector)};
        const attr = ${JSON.stringify(attr)};
        const val = ${JSON.stringify(value)};
        if (!sel || !attr) return;
        function scan() {
          document.querySelectorAll(sel).forEach(function(el) { el.setAttribute(attr, val); });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scan);
        } else { scan(); }
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 4. NETWORK / FETCH INTERCEPTION SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 14. prevent-fetch
  registerScriptlet("prevent-fetch", (args) => {
    const urlPattern = args[0] || "";
    const responseBody = args[1] || "";
    const responseType = args[2] || "default";
    return `
      (function() {
        ${HELPERS_SRC}
        const _origFetch = window.fetch;
        window.fetch = function(resource, init) {
          const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
          if (matchPattern(url, ${JSON.stringify(urlPattern)})) {
            const body = ${JSON.stringify(responseBody)} || '{}';
            return Promise.resolve(new Response(body, {
              status: 200,
              statusText: 'OK',
              headers: new Headers({ 'Content-Type': 'application/json' }),
            }));
          }
          return _origFetch.apply(this, arguments);
        };
        spoofToString(window.fetch, 'fetch');
      })();
    `;
  });

  // 15. prevent-xhr
  registerScriptlet("prevent-xhr", (args) => {
    const urlPattern = args[0] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const _origOpen = XMLHttpRequest.prototype.open;
        const _origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
          this._sbUrl = url;
          if (matchPattern(url, ${JSON.stringify(urlPattern)})) {
            this._sbBlocked = true;
          }
          return _origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          if (this._sbBlocked) {
            Object.defineProperty(this, 'readyState', { value: 4, writable: false });
            Object.defineProperty(this, 'status', { value: 200, writable: false });
            Object.defineProperty(this, 'statusText', { value: 'OK', writable: false });
            Object.defineProperty(this, 'responseText', { value: '{}', writable: false });
            Object.defineProperty(this, 'response', { value: '{}', writable: false });
            const ev = new Event('load');
            this.dispatchEvent(ev);
            if (typeof this.onload === 'function') this.onload(ev);
            const rsEv = new Event('readystatechange');
            this.dispatchEvent(rsEv);
            if (typeof this.onreadystatechange === 'function') this.onreadystatechange(rsEv);
            return;
          }
          return _origSend.apply(this, arguments);
        };
        spoofToString(XMLHttpRequest.prototype.open, 'open');
        spoofToString(XMLHttpRequest.prototype.send, 'send');
      })();
    `;
  });

  // 16. json-prune
  registerScriptlet("json-prune", (args) => {
    const propsToRemove = args[0] || "";
    const requiredProps = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const toRemove = ${JSON.stringify(propsToRemove)}.split(' ');
        const required = ${JSON.stringify(requiredProps)}.split(' ').filter(Boolean);

        function pruneObj(obj) {
          if (!obj || typeof obj !== 'object') return obj;
          if (required.length > 0) {
            const hasAll = required.every(function(p) {
              const t = walkPath(obj, p);
              return t && t.prop in t.obj;
            });
            if (!hasAll) return obj;
          }
          toRemove.forEach(function(p) {
            const t = walkPath(obj, p);
            if (t) delete t.obj[t.prop];
          });
          return obj;
        }

        const _origParse = JSON.parse;
        JSON.parse = function() {
          const r = _origParse.apply(this, arguments);
          return pruneObj(r);
        };
        spoofToString(JSON.parse, 'parse');

        // Also intercept Response.prototype.json
        const _origJson = Response.prototype.json;
        Response.prototype.json = function() {
          return _origJson.call(this).then(function(data) { return pruneObj(data); });
        };
        spoofToString(Response.prototype.json, 'json');
      })();
    `;
  });

  // 17. xml-prune
  registerScriptlet("xml-prune", (args) => {
    const selector = args[0] || "";
    const urlPattern = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const sel = ${JSON.stringify(selector)};
        const urlNeedle = ${JSON.stringify(urlPattern)};
        if (!sel) return;

        const _origOpen = XMLHttpRequest.prototype.open;
        const _origGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseXML');

        XMLHttpRequest.prototype.open = function(method, url) {
          this._sbXmlUrl = url;
          return _origOpen.apply(this, arguments);
        };

        if (_origGetter && _origGetter.get) {
          Object.defineProperty(XMLHttpRequest.prototype, 'responseXML', {
            get() {
              const doc = _origGetter.get.call(this);
              if (!doc) return doc;
              if (urlNeedle && !matchPattern(this._sbXmlUrl || '', urlNeedle)) return doc;
              try {
                doc.querySelectorAll(sel).forEach(function(el) { el.remove(); });
              } catch(_) {}
              return doc;
            },
            configurable: true,
          });
        }
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 5. COOKIE / STORAGE SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 18. cookie-remover
  registerScriptlet("cookie-remover", (args) => {
    const namePattern = args[0] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        function removeCookies() {
          document.cookie.split(';').forEach(function(c) {
            const name = c.split('=')[0].trim();
            if (matchPattern(name, ${JSON.stringify(namePattern)})) {
              document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
              document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + location.hostname;
              document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname;
            }
          });
        }
        removeCookies();
        setInterval(removeCookies, 5000);
      })();
    `;
  });

  // 19. set-cookie
  registerScriptlet("set-cookie", (args) => {
    const name = args[0] || "";
    const value = args[1] || "";
    return `
      (function() {
        if (!${JSON.stringify(name)}) return;
        const val = ${JSON.stringify(value)}.replace(/^accept$/i, '1').replace(/^reject$/i, '0');
        document.cookie = ${JSON.stringify(name)} + '=' + val + '; path=/; max-age=31536000; SameSite=Lax';
      })();
    `;
  });

  // 20. set-local-storage-item
  registerScriptlet("set-local-storage-item", (args) => {
    const key = args[0] || "";
    const value = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        if (!${JSON.stringify(key)}) return;
        try {
          localStorage.setItem(${JSON.stringify(key)}, resolveConstant(${JSON.stringify(value)}));
        } catch(_) {}
      })();
    `;
  });

  // 21. set-session-storage-item
  registerScriptlet("set-session-storage-item", (args) => {
    const key = args[0] || "";
    const value = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        if (!${JSON.stringify(key)}) return;
        try {
          sessionStorage.setItem(${JSON.stringify(key)}, resolveConstant(${JSON.stringify(value)}));
        } catch(_) {}
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 6. ANTI-DETECTION / STEALTH SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 22. spoof-css
  registerScriptlet("spoof-css", (args) => {
    const selector = args[0] || "";
    const property = args[1] || "";
    const value = args[2] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = window.getComputedStyle;
        const sel = ${JSON.stringify(selector)};
        const prop = ${JSON.stringify(property)};
        const val = ${JSON.stringify(value)};
        if (!sel || !prop) return;
        window.getComputedStyle = function(element, pseudoElt) {
          const style = _orig.call(window, element, pseudoElt);
          try {
            if (element.matches && element.matches(sel)) {
              return new Proxy(style, {
                get(target, p) {
                  if (p === prop) return val;
                  if (p === 'getPropertyValue') {
                    return function(name) {
                      if (name === prop) return val;
                      return target.getPropertyValue(name);
                    };
                  }
                  const v = target[p];
                  return typeof v === 'function' ? v.bind(target) : v;
                }
              });
            }
          } catch(_) {}
          return style;
        };
        spoofToString(window.getComputedStyle, 'getComputedStyle');
      })();
    `;
  });

  // 23. prevent-addEventListener
  registerScriptlet("prevent-addEventListener", (args) => {
    const typePattern = args[0] || "";
    const handlerPattern = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, handler, options) {
          if (matchPattern(type, ${JSON.stringify(typePattern)})) {
            if (${JSON.stringify(handlerPattern)} === '' || (typeof handler === 'function' && matchPattern(handler.toString(), ${JSON.stringify(handlerPattern)}))) {
              return;
            }
          }
          return _orig.call(this, type, handler, options);
        };
        spoofToString(EventTarget.prototype.addEventListener, 'addEventListener');
      })();
    `;
  });

  // 24. prevent-window-open
  registerScriptlet("prevent-window-open", (args) => {
    const urlPattern = args[0] || "";
    const replacement = args[1] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        const _orig = window.open;
        window.open = function(url) {
          if (matchPattern(url || '', ${JSON.stringify(urlPattern)})) {
            if (${JSON.stringify(replacement)} === 'obj') {
              // Return a fake window object
              return {
                closed: false, close: function(){}, focus: function(){},
                blur: function(){}, postMessage: function(){},
                document: { write: function(){}, close: function(){} },
                location: { href: '', replace: function(){} },
              };
            }
            return null;
          }
          return _orig.apply(this, arguments);
        };
        spoofToString(window.open, 'open');
      })();
    `;
  });

  // 25. close-window
  registerScriptlet("close-window", (args) => {
    const urlPattern = args[0] || "";
    return `
      (function() {
        ${HELPERS_SRC}
        if (${JSON.stringify(urlPattern)}) {
          if (matchPattern(location.href, ${JSON.stringify(urlPattern)})) {
            window.close();
          }
        }
      })();
    `;
  });

  // 26. nowebrtc
  registerScriptlet("nowebrtc", () => {
    return `
      (function() {
        ${HELPERS_SRC}
        const noopConstructor = function() {
          throw new DOMException('RTCPeerConnection is not allowed', 'NotAllowedError');
        };
        window.RTCPeerConnection = noopConstructor;
        window.webkitRTCPeerConnection = noopConstructor;
        window.mozRTCPeerConnection = noopConstructor;
      })();
    `;
  });

  // 27. disable-newtab-links
  registerScriptlet("disable-newtab-links", () => {
    return `
      (function() {
        function scan() {
          document.querySelectorAll('a[target="_blank"]').forEach(function(a) {
            a.removeAttribute('target');
            a.removeAttribute('rel');
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scan);
        } else { scan(); }
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
      })();
    `;
  });

  // 28. no-floc
  registerScriptlet("no-floc", () => {
    return `
      (function() {
        ${HELPERS_SRC}
        // Disable FLoC / Topics API
        if (document.interestCohort) {
          document.interestCohort = function() { return Promise.reject(new DOMException('', 'NotAllowedError')); };
        }
        // Topics API
        if (navigator.browsingTopics) {
          navigator.browsingTopics = function() { return Promise.resolve([]); };
        }
        // Attribution Reporting
        if (navigator.joinAdInterestGroup) {
          navigator.joinAdInterestGroup = function() { return Promise.resolve(); };
        }
        if (navigator.leaveAdInterestGroup) {
          navigator.leaveAdInterestGroup = function() { return Promise.resolve(); };
        }
        if (navigator.runAdAuction) {
          navigator.runAdAuction = function() { return Promise.resolve(null); };
        }
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 7. ANTI-ADBLOCK SPECIFIC SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 29. fuckadblock-defuser
  registerScriptlet("fuckadblock-defuser", () => {
    return `
      (function() {
        ${HELPERS_SRC}
        // FuckAdBlock creates window.fuckAdBlock or window.FuckAdBlock
        // We provide a fake instance that always reports "not detected"
        function FakeFAB() {
          this._callbacks = { detected: [], notDetected: [] };
        }
        FakeFAB.prototype.setOption = function() { return this; };
        FakeFAB.prototype.check = function(loop) {
          var self = this;
          self._callbacks.notDetected.forEach(function(fn) {
            try { fn(); } catch(_) {}
          });
          if (loop) {
            setTimeout(function() { self.check(true); }, 2000);
          }
          return self;
        };
        FakeFAB.prototype.emitEvent = function() { return this; };
        FakeFAB.prototype.clearEvent = function() { return this; };
        FakeFAB.prototype.on = function(detected, fn) {
          if (detected === false || detected === 'notDetected') {
            this._callbacks.notDetected.push(fn);
            try { fn(); } catch(_) {}
          } else {
            this._callbacks.detected.push(fn);
          }
          return this;
        };
        FakeFAB.prototype.onDetected = function(fn) { this._callbacks.detected.push(fn); return this; };
        FakeFAB.prototype.onNotDetected = function(fn) {
          this._callbacks.notDetected.push(fn);
          try { fn(); } catch(_) {}
          return this;
        };

        var fab = new FakeFAB();
        Object.defineProperty(window, 'fuckAdBlock', { value: fab, writable: false, configurable: false });
        Object.defineProperty(window, 'FuckAdBlock', { value: FakeFAB, writable: false, configurable: false });
      })();
    `;
  });

  // 30. blockadblock-defuser
  registerScriptlet("blockadblock-defuser", () => {
    return `
      (function() {
        ${HELPERS_SRC}
        // BlockAdBlock pattern — similar to FuckAdBlock
        function FakeBAB() {
          this._callbacks = [];
          this._notCallbacks = [];
          this._detected = false;
        }
        FakeBAB.prototype.arm = function() { return this; };
        FakeBAB.prototype.disarm = function() { return this; };
        FakeBAB.prototype.setOption = function() { return this; };
        FakeBAB.prototype.check = function() {
          var self = this;
          self._notCallbacks.forEach(function(fn) { try { fn(); } catch(_) {} });
          return self;
        };
        FakeBAB.prototype.on = function(detected, fn) {
          if (detected === false || detected === 'notDetected') {
            this._notCallbacks.push(fn);
            try { fn(); } catch(_) {}
          } else {
            this._callbacks.push(fn);
          }
          return this;
        };
        FakeBAB.prototype.onDetected = function(fn) { this._callbacks.push(fn); return this; };
        FakeBAB.prototype.onNotDetected = function(fn) {
          this._notCallbacks.push(fn);
          try { fn(); } catch(_) {}
          return this;
        };

        var bab = new FakeBAB();
        Object.defineProperty(window, 'blockAdBlock', { value: bab, writable: false, configurable: false });
        Object.defineProperty(window, 'BlockAdBlock', { value: FakeBAB, writable: false, configurable: false });
      })();
    `;
  });

  // 31. adfly-defuser
  registerScriptlet("adfly-defuser", () => {
    return `
      (function() {
        // Adfly uses a variable 'ysmm' to encode the real URL
        // Intercept it and redirect immediately
        var realURL = '';
        Object.defineProperty(window, 'ysmm', {
          set: function(val) {
            if (typeof val === 'string' && val.length > 0) {
              try {
                // Decode adfly's base64 obfuscation
                var decoded = atob(val);
                // Adfly interleaves characters
                var left = '', right = '';
                for (var i = 0; i < decoded.length; i++) {
                  if (i % 2 === 0) left += decoded.charAt(i);
                  else right = decoded.charAt(i) + right;
                }
                var url = left + right;
                url = url.substring(2); // Remove first 2 chars (padding)
                if (url.indexOf('http') === 0) {
                  window.location.href = url;
                }
              } catch(_) {}
            }
          },
          get: function() { return ''; },
          configurable: false,
        });
      })();
    `;
  });

  // 32. overlay-buster
  registerScriptlet("overlay-buster", () => {
    return `
      (function() {
        function bust() {
          // Remove fixed/absolute positioned overlays
          var allEls = document.querySelectorAll('div, section, aside, [role="dialog"]');
          allEls.forEach(function(el) {
            var style = window.getComputedStyle(el);
            var pos = style.getPropertyValue('position');
            var zIndex = parseInt(style.getPropertyValue('z-index'), 10) || 0;
            if ((pos === 'fixed' || pos === 'absolute') && zIndex > 999) {
              var rect = el.getBoundingClientRect();
              // If it covers most of the viewport, it's an overlay
              if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
                el.remove();
              }
            }
          });

          // Restore body scrolling
          var body = document.body;
          var html = document.documentElement;
          if (body) {
            body.style.removeProperty('overflow');
            body.style.removeProperty('position');
            body.classList.remove('modal-open', 'no-scroll', 'noscroll', 'overlay-active');
          }
          if (html) {
            html.style.removeProperty('overflow');
            html.style.removeProperty('position');
          }

          // Remove blur from content
          document.querySelectorAll('[style*="blur"], [style*="filter"]').forEach(function(el) {
            el.style.removeProperty('filter');
            el.style.removeProperty('-webkit-filter');
          });

          // Remove adblock-specific overlays
          var selectors = [
            '[class*="adblock"]', '[id*="adblock"]',
            '[class*="ad-block"]', '[id*="ad-block"]',
            '[class*="adb-overlay"]', '[id*="adb-overlay"]',
            '[class*="block-adb"]', '[id*="block-adb"]',
            '[class*="ad-blocker"]', '[id*="ad-blocker"]',
            '[class*="anti-adb"]', '[id*="anti-adb"]',
            '[class*="adblock-notice"]', '[class*="adblock-modal"]',
            '[class*="adblock-overlay"]', '[class*="adblock-wall"]',
          ];
          document.querySelectorAll(selectors.join(',')).forEach(function(el) { el.remove(); });
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            setTimeout(bust, 500);
            setTimeout(bust, 2000);
            setTimeout(bust, 5000);
          });
        } else {
          setTimeout(bust, 500);
        }

        // Periodic check
        var count = 0;
        var checker = setInterval(function() {
          bust();
          if (++count >= 12) clearInterval(checker);
        }, 2500);
      })();
    `;
  });

  // 33. alert-buster
  registerScriptlet("alert-buster", () => {
    return `
      (function() {
        ${HELPERS_SRC}
        window.alert = function() {};
        spoofToString(window.alert, 'alert');
        window.confirm = function() { return true; };
        spoofToString(window.confirm, 'confirm');
        window.prompt = function() { return ''; };
        spoofToString(window.prompt, 'prompt');
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 8. LAYOUT / VISUAL SPOOFING SCRIPTLETS
  // ═══════════════════════════════════════════════════════════════════════════

  // 34. spoof-offsetHeight
  registerScriptlet("spoof-offsetHeight", (args) => {
    const selector = args[0] || "";
    const value = args[1] || "1";
    return `
      (function() {
        const sel = ${JSON.stringify(selector)};
        const fakeVal = parseInt(${JSON.stringify(value)}, 10) || 1;
        const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
        const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
        if (origH && origH.get) {
          Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
            get() {
              if (sel && this.matches && this.matches(sel)) return fakeVal;
              return origH.get.call(this);
            },
            configurable: true,
          });
        }
        if (origW && origW.get) {
          Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
            get() {
              if (sel && this.matches && this.matches(sel)) return fakeVal;
              return origW.get.call(this);
            },
            configurable: true,
          });
        }
      })();
    `;
  });

  // 35. spoof-getBoundingClientRect
  registerScriptlet("spoof-getBoundingClientRect", (args) => {
    const selector = args[0] || "";
    const width = args[1] || "300";
    const height = args[2] || "250";
    return `
      (function() {
        ${HELPERS_SRC}
        const sel = ${JSON.stringify(selector)};
        const w = parseFloat(${JSON.stringify(width)}) || 300;
        const h = parseFloat(${JSON.stringify(height)}) || 250;
        const _orig = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function() {
          const rect = _orig.call(this);
          try {
            if (sel && this.matches && this.matches(sel)) {
              return new DOMRect(rect.x, rect.y, w, h);
            }
          } catch(_) {}
          return rect;
        };
        spoofToString(Element.prototype.getBoundingClientRect, 'getBoundingClientRect');
      })();
    `;
  });

  // 36. spoof-getComputedStyle
  registerScriptlet("spoof-getComputedStyle", (args) => {
    const selector = args[0] || "";
    // Remaining args are property:value pairs
    const propValues = {};
    for (let i = 1; i < args.length; i++) {
      const pair = args[i].split(":");
      if (pair.length >= 2) propValues[pair[0].trim()] = pair.slice(1).join(":").trim();
    }
    const pvJSON = JSON.stringify(propValues);
    return `
      (function() {
        ${HELPERS_SRC}
        const sel = ${JSON.stringify(selector)};
        const propMap = ${pvJSON};
        const _orig = window.getComputedStyle;
        window.getComputedStyle = function(element, pseudoElt) {
          const style = _orig.call(window, element, pseudoElt);
          try {
            if (sel && element.matches && element.matches(sel)) {
              return new Proxy(style, {
                get(target, p) {
                  if (p in propMap) return propMap[p];
                  if (p === 'getPropertyValue') {
                    return function(name) {
                      if (name in propMap) return propMap[name];
                      return target.getPropertyValue(name);
                    };
                  }
                  const v = target[p];
                  return typeof v === 'function' ? v.bind(target) : v;
                }
              });
            }
          } catch(_) {}
          return style;
        };
        spoofToString(window.getComputedStyle, 'getComputedStyle');
      })();
    `;
  });

  // 37. hide-in-shadow-dom
  registerScriptlet("hide-in-shadow-dom", (args) => {
    const selector = args[0] || "";
    return `
      (function() {
        const sel = ${JSON.stringify(selector)};
        if (!sel) return;

        function hideShadow(root) {
          try {
            root.querySelectorAll(sel).forEach(function(el) {
              el.style.setProperty('display', 'none', 'important');
            });
          } catch(_) {}
          // Recurse into nested shadow roots
          root.querySelectorAll('*').forEach(function(el) {
            if (el.shadowRoot) hideShadow(el.shadowRoot);
          });
        }

        // Patch attachShadow to monitor new shadow roots
        const _origAttach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(init) {
          const shadow = _origAttach.call(this, init);
          new MutationObserver(function() { hideShadow(shadow); })
            .observe(shadow, { childList: true, subtree: true });
          return shadow;
        };

        // Scan existing shadow roots
        function scanAll() {
          document.querySelectorAll('*').forEach(function(el) {
            if (el.shadowRoot) hideShadow(el.shadowRoot);
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scanAll);
        } else { scanAll(); }
        new MutationObserver(scanAll).observe(document.documentElement, { childList: true, subtree: true });
      })();
    `;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULT STEALTH LAYER (always-on, every page)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate the always-on stealth code that runs on every page.
   * This is the core anti-adblock evasion layer.
   */
  function generateStealthCode() {
    return `
      (function() {
        "use strict";
        ${HELPERS_SRC}

        // ── Spoof getComputedStyle for bait elements ────────────────────────
        const _origGetComputedStyle = window.getComputedStyle;
        window.getComputedStyle = function(element, pseudoElt) {
          const style = _origGetComputedStyle.call(window, element, pseudoElt);
          if (isAdBaitElement(element)) {
            return new Proxy(style, {
              get(target, prop) {
                if (prop === 'display') return 'block';
                if (prop === 'visibility') return 'visible';
                if (prop === 'opacity') return '1';
                if (prop === 'height') return '250px';
                if (prop === 'width') return '300px';
                if (prop === 'position') return 'static';
                if (prop === 'clipPath' || prop === 'clip-path') return 'none';
                if (prop === 'overflow') return 'visible';
                if (prop === 'getPropertyValue') {
                  return function(name) {
                    if (name === 'display') return 'block';
                    if (name === 'visibility') return 'visible';
                    if (name === 'opacity') return '1';
                    if (name === 'height') return '250px';
                    if (name === 'width') return '300px';
                    if (name === 'clip-path') return 'none';
                    return target.getPropertyValue(name);
                  };
                }
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
              },
            });
          }
          return style;
        };
        spoofToString(window.getComputedStyle, 'getComputedStyle');

        // ── Spoof dimension properties for bait elements ────────────────────
        var propsToSpoof = [
          'offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth',
          'scrollHeight', 'scrollWidth',
        ];
        propsToSpoof.forEach(function(prop) {
          var origDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
          if (!origDesc || !origDesc.get) return;
          Object.defineProperty(HTMLElement.prototype, prop, {
            get: function() {
              var realValue = origDesc.get.call(this);
              if (realValue === 0 && isAdBaitElement(this)) {
                return prop.indexOf('Height') !== -1 ? 250 : 300;
              }
              return realValue;
            },
            configurable: true,
          });
        });

        // ── Spoof getBoundingClientRect for bait elements ───────────────────
        var _origGetBCR = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function() {
          var rect = _origGetBCR.call(this);
          if (isAdBaitElement(this) && rect.height === 0) {
            return new DOMRect(rect.x, rect.y, 300, 250);
          }
          return rect;
        };
        spoofToString(Element.prototype.getBoundingClientRect, 'getBoundingClientRect');

        // ── Block known anti-adblock properties ─────────────────────────────
        var BLOCKED_PROPS = [
          'adBlockDetected', 'adblockDetected', 'adBlockEnabled',
          'blockAdBlock', 'fuckAdBlock', 'sniffAdBlock',
          'canRunAds', 'isAdBlockActive', 'adBlocker',
          'ads_blocked', 'adsBlocked', 'adblockEnabled',
        ];
        BLOCKED_PROPS.forEach(function(prop) {
          try {
            Object.defineProperty(window, prop, {
              get: function() { return prop === 'canRunAds' ? true : false; },
              set: function() { return true; },
              configurable: false,
            });
          } catch(_) {}
        });

        // ── Neutralize timer-based detection ────────────────────────────────
        var _origSetTimeout = window.setTimeout;
        var _origSetInterval = window.setInterval;
        var DETECT_RE = [
          /adblock/i, /ad[\\s_-]?block/i, /blockad/i,
          /adsBlocked/i, /isBlocked/i, /adDetect/i,
          /showAdBlockMessage/i, /adBlockWall/i, /adsbygoogle/i,
        ];

        function isDetectionFn(fn) {
          if (typeof fn !== 'function') return false;
          var src = fn.toString();
          return DETECT_RE.some(function(p) { return p.test(src); });
        }

        window.setTimeout = function(fn, delay) {
          if (isDetectionFn(fn)) return _origSetTimeout.call(window, function(){}, delay);
          return _origSetTimeout.apply(window, arguments);
        };
        spoofToString(window.setTimeout, 'setTimeout');

        window.setInterval = function(fn, delay) {
          if (isDetectionFn(fn)) return _origSetInterval.call(window, function(){}, delay);
          return _origSetInterval.apply(window, arguments);
        };
        spoofToString(window.setInterval, 'setInterval');

        // ── Prevent MutationObserver on bait elements ───────────────────────
        var _origObserve = MutationObserver.prototype.observe;
        MutationObserver.prototype.observe = function(target, options) {
          if (isAdBaitElement(target)) return;
          return _origObserve.call(this, target, options);
        };
        spoofToString(MutationObserver.prototype.observe, 'observe');

        // ── Spoof navigator.plugins ─────────────────────────────────────────
        try {
          Object.defineProperty(navigator, 'plugins', {
            get: function() { return [1, 2, 3, 4, 5]; },
            configurable: true,
          });
        } catch(_) {}

        // ── Disable FLoC / Topics ───────────────────────────────────────────
        if (document.interestCohort) {
          document.interestCohort = function() { return Promise.reject(new DOMException('', 'NotAllowedError')); };
        }
        if (navigator.browsingTopics) {
          navigator.browsingTopics = function() { return Promise.resolve([]); };
        }

        // ── Preemptive FuckAdBlock / BlockAdBlock defusing ──────────────────
        (function() {
          function FakeABDetector() {
            this._cb = { det: [], not: [] };
          }
          FakeABDetector.prototype.setOption = function() { return this; };
          FakeABDetector.prototype.check = function() {
            var self = this;
            self._cb.not.forEach(function(fn) { try { fn(); } catch(_) {} });
            return self;
          };
          FakeABDetector.prototype.emitEvent = function() { return this; };
          FakeABDetector.prototype.clearEvent = function() { return this; };
          FakeABDetector.prototype.on = function(detected, fn) {
            if (detected === false || detected === 'notDetected') {
              this._cb.not.push(fn);
              try { fn(); } catch(_) {}
            } else { this._cb.det.push(fn); }
            return this;
          };
          FakeABDetector.prototype.onDetected = function(fn) { this._cb.det.push(fn); return this; };
          FakeABDetector.prototype.onNotDetected = function(fn) {
            this._cb.not.push(fn);
            try { fn(); } catch(_) {}
            return this;
          };
          FakeABDetector.prototype.arm = function() { return this; };
          FakeABDetector.prototype.disarm = function() { return this; };

          var fake = new FakeABDetector();
          try { Object.defineProperty(window, 'fuckAdBlock',  { value: fake, writable: false, configurable: false }); } catch(_) {}
          try { Object.defineProperty(window, 'blockAdBlock',  { value: fake, writable: false, configurable: false }); } catch(_) {}
          try { Object.defineProperty(window, 'FuckAdBlock',   { value: FakeABDetector, writable: false, configurable: false }); } catch(_) {}
          try { Object.defineProperty(window, 'BlockAdBlock',  { value: FakeABDetector, writable: false, configurable: false }); } catch(_) {}
        })();

      })();
    `;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // INJECTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Inject code into the PAGE context via a script element.
   * Must happen synchronously at document_start to beat page scripts.
   */
  function injectIntoPage(code) {
    const script = document.createElement("script");
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  /**
   * Execute a named scriptlet with arguments in page context.
   */
  function runScriptlet(name, args) {
    const fn = SCRIPTLETS[name];
    if (!fn) return;
    const code = fn(args || []);
    if (code) injectIntoPage(code);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DOMAIN-SPECIFIC SCRIPTLET CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Built-in domain rules. These are hardcoded for common sites.
   * Format: { domain: [ [scriptletName, ...args], ... ] }
   */
  const BUILTIN_DOMAIN_RULES = {
    // Forbes anti-adblock
    "forbes.com": [
      ["set-constant", "canRunAds", "true"],
      ["set-constant", "isAdBlockActive", "false"],
      ["overlay-buster"],
    ],
    // Fandom.com
    "fandom.com": [
      ["set-constant", "ads.hasBlocker", "false"],
      ["overlay-buster"],
    ],
    // Business Insider
    "businessinsider.com": [
      ["set-constant", "adBlockDetected", "false"],
      ["overlay-buster"],
    ],
    // Adf.ly / Adfly
    "adf.ly": [
      ["adfly-defuser"],
    ],
    // Generic news sites with paywalls/walls
    "wired.com": [
      ["overlay-buster"],
      ["set-constant", "adBlockEnabled", "false"],
    ],
  };

  /**
   * Loaded from chrome.storage (set by popup/options).
   * Format same as BUILTIN_DOMAIN_RULES.
   */
  let customDomainRules = {};

  /**
   * Match current domain against rules, supporting wildcard subdomains.
   */
  function getDomainRules(hostname) {
    const rules = [];

    function checkRules(ruleSet) {
      for (const [domain, scriptlets] of Object.entries(ruleSet)) {
        if (
          hostname === domain ||
          hostname.endsWith("." + domain)
        ) {
          rules.push(...scriptlets);
        }
      }
    }

    checkRules(BUILTIN_DOMAIN_RULES);
    checkRules(customDomainRules);
    return rules;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ANTI-ADBLOCK WALL REMOVAL (content script context)
  // ═══════════════════════════════════════════════════════════════════════════

  function removeAntiAdblockWalls() {
    const selectors = [
      '[class*="adblock-notice"]', '[class*="adblock-overlay"]',
      '[class*="adblock-modal"]', '[id*="adblock-notice"]',
      '[id*="adblock-overlay"]', '[id*="adblock-modal"]',
      '[class*="ad-blocker-warning"]', '[class*="adb-overlay"]',
      '[id*="block-adb"]', '[class*="block-adb"]',
      '[class*="adblock-wall"]', '[id*="adblock-wall"]',
      '[class*="anti-adb"]', '[id*="anti-adb"]',
      '[class*="adblock-msg"]', '[id*="adblock-msg"]',
    ];

    document.querySelectorAll(selectors.join(",")).forEach((el) => el.remove());

    // Restore scrolling
    if (document.body) {
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("position");
      document.body.classList.remove(
        "modal-open", "no-scroll", "noscroll", "overlay-active",
        "adblock-modal-open", "has-overlay"
      );
    }
    if (document.documentElement) {
      document.documentElement.style.removeProperty("overflow");
      document.documentElement.style.removeProperty("position");
    }

    // Remove blur from content
    document.querySelectorAll("[style*='blur']").forEach((el) => {
      el.style.removeProperty("filter");
      el.style.removeProperty("-webkit-filter");
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // BOOTSTRAP — execute everything
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Inject the always-on stealth layer FIRST (before any page JS)
  injectIntoPage(generateStealthCode());

  // 2. Activate domain-specific scriptlets
  const hostname = location.hostname.replace(/^www\./, "");
  const domainRules = getDomainRules(hostname);
  for (const rule of domainRules) {
    const [name, ...args] = rule;
    runScriptlet(name, args);
  }

  // 3. Load custom rules from chrome.storage (async, but most page scripts
  //    haven't loaded yet at document_start)
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["scriptletRules", "disabledDomains"], (result) => {
        // Check if this domain is disabled
        const disabled = result.disabledDomains || [];
        if (disabled.includes(hostname)) return;

        // Apply custom scriptlet rules
        const allRules = result.scriptletRules || {};
        const customRules = getDomainRulesFromStorage(allRules, hostname);
        for (const rule of customRules) {
          const [name, ...args] = rule;
          runScriptlet(name, args);
        }
      });
    }
  } catch (_) {}

  // 3b. Load anti-adblock rules (object format: {scriptlet, args})
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['antiAdblockRules'], (result) => {
        const allRules = result.antiAdblockRules;
        if (!allRules) return;
        // Collect generic + domain-specific rules
        const rules = [];
        if (allRules.generic) rules.push(...allRules.generic);
        for (const [domain, scriptlets] of Object.entries(allRules)) {
          if (domain === '_meta' || domain === 'generic') continue;
          if (hostname === domain || hostname.endsWith('.' + domain)) {
            rules.push(...scriptlets);
          }
        }
        for (const rule of rules) {
          if (SCRIPTLETS[rule.scriptlet]) {
            runScriptlet(rule.scriptlet, rule.args || []);
          }
        }
      });
    }
  } catch (_) {}

  function getDomainRulesFromStorage(allRules, hostname) {
    const rules = [];
    for (const [domain, scriptlets] of Object.entries(allRules)) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        rules.push(...scriptlets);
      }
    }
    return rules;
  }

  // 4. Run wall removal on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(removeAntiAdblockWalls, 500);
      setTimeout(removeAntiAdblockWalls, 2000);
      setTimeout(removeAntiAdblockWalls, 5000);
    });
  } else {
    setTimeout(removeAntiAdblockWalls, 500);
  }

  // Periodic wall check
  let wallCheckCount = 0;
  const wallChecker = setInterval(() => {
    removeAntiAdblockWalls();
    if (++wallCheckCount >= 6) clearInterval(wallChecker);
  }, 5000);

  // 5. Expose scriptlet engine to background script for dynamic injection
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "run-scriptlet" && msg.name && SCRIPTLETS[msg.name]) {
        runScriptlet(msg.name, msg.args || []);
        sendResponse({ ok: true });
      } else if (msg.type === "list-scriptlets") {
        sendResponse({ scriptlets: Object.keys(SCRIPTLETS) });
      } else if (msg.type === "remove-walls") {
        removeAntiAdblockWalls();
        sendResponse({ ok: true });
      }
    });
  }

})();
