/**
 * ShadowBlock — Element Picker (Content Script)
 * Lets users visually select any element on the page and create a custom block rule.
 *
 * Flow:
 * 1. User right-clicks → "ShadowBlock: Block this element" context menu
 * 2. Service worker sends "activateElementPicker" message
 * 3. This script enters picker mode: overlay + highlight + tooltip
 * 4. User clicks element → confirmation dialog with selector preview
 * 5. User confirms → rule saved to chrome.storage.local → element hidden immediately
 */

(() => {
  "use strict";

  let pickerActive = false;
  let overlay = null;
  let highlight = null;
  let tooltip = null;
  let dialog = null;
  let currentTarget = null;

  // ── Listen for activation ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "activateElementPicker" && !pickerActive) {
      activatePicker();
    }
  });

  // ── Selector Generation ────────────────────────────────────────────────

  /**
   * Generate a CSS selector for the given element.
   * Priority: unique ID > distinctive classes > data attributes > path-based
   */
  function generateSelector(el) {
    // Skip html/body
    if (el === document.documentElement || el === document.body) return null;

    // Strategy 1: Unique ID
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }

    // Strategy 2: Distinctive classes
    const classSelector = tryClassSelector(el);
    if (classSelector) return classSelector;

    // Strategy 3: Data attributes (often used for ad slots)
    const dataSelector = tryDataAttributes(el);
    if (dataSelector) return dataSelector;

    // Strategy 4: Tag + classes combo
    const tagClassSelector = tryTagClassSelector(el);
    if (tagClassSelector) return tagClassSelector;

    // Strategy 5: Path-based selector with nth-child
    return buildPathSelector(el);
  }

  function tryClassSelector(el) {
    if (!el.classList || el.classList.length === 0) return null;

    // Try single distinctive classes first
    for (const cls of el.classList) {
      const sel = `.${CSS.escape(cls)}`;
      try {
        const matches = document.querySelectorAll(sel);
        if (matches.length === 1) return sel;
      } catch (_) {}
    }

    // Try combinations of 2 classes
    if (el.classList.length >= 2) {
      const classes = Array.from(el.classList);
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          const sel = `.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
          try {
            const matches = document.querySelectorAll(sel);
            if (matches.length === 1) return sel;
          } catch (_) {}
        }
      }
    }

    // Try all classes combined
    if (el.classList.length >= 2) {
      const sel = Array.from(el.classList).map(c => `.${CSS.escape(c)}`).join("");
      try {
        const matches = document.querySelectorAll(sel);
        if (matches.length === 1) return sel;
      } catch (_) {}
    }

    return null;
  }

  function tryDataAttributes(el) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-")) {
        const sel = `${el.tagName.toLowerCase()}[${attr.name}="${CSS.escape(attr.value)}"]`;
        try {
          const matches = document.querySelectorAll(sel);
          if (matches.length === 1) return sel;
        } catch (_) {}
      }
    }
    return null;
  }

  function tryTagClassSelector(el) {
    if (!el.classList || el.classList.length === 0) return null;
    const tag = el.tagName.toLowerCase();

    for (const cls of el.classList) {
      const sel = `${tag}.${CSS.escape(cls)}`;
      try {
        const matches = document.querySelectorAll(sel);
        if (matches.length === 1) return sel;
      } catch (_) {}
    }
    return null;
  }

  function buildPathSelector(el) {
    const parts = [];
    let current = el;
    const maxDepth = 4;

    for (let i = 0; i < maxDepth && current && current !== document.body && current !== document.documentElement; i++) {
      let part = current.tagName.toLowerCase();

      // Add an ID if available (stops the chain)
      if (current.id) {
        part = `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      }

      // Add first class if available
      if (current.classList && current.classList.length > 0) {
        part += `.${CSS.escape(current.classList[0])}`;
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
    }

    const sel = parts.join(" > ");

    // Validate: does it match only our target?
    try {
      const matches = document.querySelectorAll(sel);
      if (matches.length === 1) return sel;
    } catch (_) {}

    // If still not unique, return it anyway (best effort)
    return sel;
  }

  // ── Picker Mode UI ────────────────────────────────────────────────────

  function activatePicker() {
    pickerActive = true;

    // Full-page translucent overlay
    overlay = document.createElement("div");
    overlay.id = "__sb_picker_overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0, 0, 0, 0.15)",
      zIndex: "2147483640",
      cursor: "crosshair",
      pointerEvents: "none",
    });

    // Highlight box (follows hovered element)
    highlight = document.createElement("div");
    highlight.id = "__sb_picker_highlight";
    Object.assign(highlight.style, {
      position: "fixed",
      border: "2px solid #e74c3c",
      backgroundColor: "rgba(231, 76, 60, 0.2)",
      zIndex: "2147483641",
      pointerEvents: "none",
      transition: "all 0.05s ease",
      borderRadius: "2px",
    });

    // Tooltip showing the selector
    tooltip = document.createElement("div");
    tooltip.id = "__sb_picker_tooltip";
    Object.assign(tooltip.style, {
      position: "fixed",
      backgroundColor: "#1a1a2e",
      color: "#e6e6e6",
      padding: "6px 10px",
      borderRadius: "4px",
      fontSize: "12px",
      fontFamily: "monospace",
      zIndex: "2147483642",
      pointerEvents: "none",
      maxWidth: "400px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    });

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(highlight);
    document.documentElement.appendChild(tooltip);

    document.addEventListener("mousemove", onPickerMouseMove, true);
    document.addEventListener("click", onPickerClick, true);
    document.addEventListener("keydown", onPickerKeyDown, true);
  }

  function deactivatePicker() {
    pickerActive = false;
    currentTarget = null;

    document.removeEventListener("mousemove", onPickerMouseMove, true);
    document.removeEventListener("click", onPickerClick, true);
    document.removeEventListener("keydown", onPickerKeyDown, true);

    if (overlay) { overlay.remove(); overlay = null; }
    if (highlight) { highlight.remove(); highlight = null; }
    if (tooltip) { tooltip.remove(); tooltip = null; }
    if (dialog) { dialog.remove(); dialog = null; }
  }

  function isPickerUI(el) {
    if (!el) return false;
    const ids = ["__sb_picker_overlay", "__sb_picker_highlight", "__sb_picker_tooltip", "__sb_picker_dialog"];
    return ids.includes(el.id) || el.closest?.("#__sb_picker_dialog");
  }

  function onPickerMouseMove(e) {
    // Get element under cursor (ignoring our overlay)
    overlay.style.display = "none";
    highlight.style.display = "none";
    tooltip.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.display = "";
    highlight.style.display = "";
    tooltip.style.display = "";

    if (!el || el === document.documentElement || el === document.body || isPickerUI(el)) {
      highlight.style.display = "none";
      tooltip.style.display = "none";
      currentTarget = null;
      return;
    }

    currentTarget = el;
    const rect = el.getBoundingClientRect();

    // Position highlight
    Object.assign(highlight.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    // Generate and show selector
    const selector = generateSelector(el);
    tooltip.textContent = selector || el.tagName.toLowerCase();
    tooltip.style.display = "block";

    // Position tooltip above or below the element
    let tooltipTop = rect.top - 30;
    if (tooltipTop < 5) tooltipTop = rect.bottom + 5;
    let tooltipLeft = e.clientX + 10;
    if (tooltipLeft + 400 > window.innerWidth) tooltipLeft = e.clientX - 300;

    Object.assign(tooltip.style, {
      top: `${tooltipTop}px`,
      left: `${tooltipLeft}px`,
    });
  }

  function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!currentTarget || isPickerUI(currentTarget)) return;

    const target = currentTarget;
    const selector = generateSelector(target);

    // Hide picker UI temporarily
    overlay.style.display = "none";
    highlight.style.display = "none";
    tooltip.style.display = "none";

    showConfirmDialog(target, selector);
  }

  function onPickerKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      deactivatePicker();
    }
  }

  // ── Confirmation Dialog ────────────────────────────────────────────────

  function showConfirmDialog(target, selector) {
    if (dialog) dialog.remove();

    dialog = document.createElement("div");
    dialog.id = "__sb_picker_dialog";
    Object.assign(dialog.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      backgroundColor: "#1a1a2e",
      color: "#e6e6e6",
      borderRadius: "8px",
      padding: "20px",
      zIndex: "2147483645",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "14px",
      width: "420px",
      maxWidth: "90vw",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      border: "1px solid #2a2a4a",
    });

    const tagName = target.tagName.toLowerCase();
    const classes = target.className ? `.${Array.from(target.classList).join(".")}` : "";
    const textPreview = (target.textContent || "").trim().slice(0, 80);
    const dims = target.getBoundingClientRect();

    const titleDiv = document.createElement("div");
    Object.assign(titleDiv.style, { marginBottom: "14px", fontSize: "16px", fontWeight: "600", color: "#e74c3c" });
    titleDiv.textContent = "Block this element?";

    const selectorDiv = document.createElement("div");
    Object.assign(selectorDiv.style, { background: "#0d0d1a", borderRadius: "4px", padding: "10px", marginBottom: "12px", fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all", color: "#8888cc" });
    selectorDiv.textContent = selector || "unable to generate selector";

    const infoDiv = document.createElement("div");
    Object.assign(infoDiv.style, { marginBottom: "12px", fontSize: "12px", color: "#888" });

    const elementLine = document.createElement("div");
    const elementLabel = document.createElement("strong");
    elementLabel.textContent = "Element: ";
    elementLine.appendChild(elementLabel);
    const elementText = classes
      ? `<${tagName} class="${classes.slice(1).replace(/\./g, " ")}">`
      : `<${tagName}>`;
    elementLine.appendChild(document.createTextNode(elementText));
    infoDiv.appendChild(elementLine);

    const sizeLine = document.createElement("div");
    const sizeLabel = document.createElement("strong");
    sizeLabel.textContent = "Size: ";
    sizeLine.appendChild(sizeLabel);
    sizeLine.appendChild(document.createTextNode(`${Math.round(dims.width)} x ${Math.round(dims.height)}px`));
    infoDiv.appendChild(sizeLine);

    if (textPreview) {
      const textLine = document.createElement("div");
      const textLabel = document.createElement("strong");
      textLabel.textContent = "Text: ";
      textLine.appendChild(textLabel);
      const displayText = target.textContent.trim().length > 80 ? textPreview + "..." : textPreview;
      textLine.appendChild(document.createTextNode(displayText));
      infoDiv.appendChild(textLine);
    }

    const buttonDiv = document.createElement("div");
    Object.assign(buttonDiv.style, { display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" });

    const cancelBtn = document.createElement("button");
    cancelBtn.id = "__sb_pick_cancel";
    Object.assign(cancelBtn.style, { padding: "8px 16px", border: "1px solid #444", background: "transparent", color: "#aaa", borderRadius: "4px", cursor: "pointer", fontSize: "13px" });
    cancelBtn.textContent = "Cancel";

    const everywhereBtn = document.createElement("button");
    everywhereBtn.id = "__sb_pick_everywhere";
    Object.assign(everywhereBtn.style, { padding: "8px 16px", border: "1px solid #555", background: "#2a2a4a", color: "#ccc", borderRadius: "4px", cursor: "pointer", fontSize: "13px" });
    everywhereBtn.textContent = "Block everywhere";

    const siteBtn = document.createElement("button");
    siteBtn.id = "__sb_pick_site";
    Object.assign(siteBtn.style, { padding: "8px 16px", border: "none", background: "#e74c3c", color: "white", borderRadius: "4px", cursor: "pointer", fontSize: "13px", fontWeight: "600" });
    siteBtn.textContent = "Block on this site";

    buttonDiv.appendChild(cancelBtn);
    buttonDiv.appendChild(everywhereBtn);
    buttonDiv.appendChild(siteBtn);

    dialog.appendChild(titleDiv);
    dialog.appendChild(selectorDiv);
    dialog.appendChild(infoDiv);
    dialog.appendChild(buttonDiv);

    document.documentElement.appendChild(dialog);

    cancelBtn.addEventListener("click", () => {
      deactivatePicker();
    });

    siteBtn.addEventListener("click", () => {
      saveRule(selector, location.hostname, target);
    });

    everywhereBtn.addEventListener("click", () => {
      saveRule(selector, "*", target);
    });
  }

  // ── Save Rule ──────────────────────────────────────────────────────────

  async function saveRule(selector, domain, targetEl) {
    if (!selector) {
      deactivatePicker();
      return;
    }

    const rule = {
      selector,
      domain, // hostname or "*" for everywhere
      createdAt: Date.now(),
      url: location.href,
    };

    try {
      const data = await chrome.storage.local.get(["userRules"]);
      const userRules = data.userRules || [];

      // Avoid duplicates
      const isDuplicate = userRules.some(
        (r) => r.selector === rule.selector && r.domain === rule.domain
      );

      if (!isDuplicate) {
        userRules.push(rule);
        await chrome.storage.local.set({ userRules });
      }

      // Immediately hide the element
      hideElement(targetEl);

      // Also inject the rule as CSS so it persists on page
      injectUserRule(rule);

    } catch (err) {
      console.error("[ShadowBlock] Failed to save rule:", err);
    }

    deactivatePicker();
  }

  function hideElement(el) {
    if (!el) return;
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("overflow", "hidden", "important");
    el.style.setProperty("clip-path", "inset(100%)", "important");
  }

  function injectUserRule(rule) {
    const hostname = location.hostname;
    if (rule.domain !== "*" && rule.domain !== hostname) return;

    let styleEl = document.getElementById("__sb_user_rules");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "__sb_user_rules";
      (document.head || document.documentElement).appendChild(styleEl);
    }

    // Use insertRule instead of textContent += to avoid full style re-parse
    try {
      const sheet = styleEl.sheet;
      if (sheet) {
        sheet.insertRule(
          `${rule.selector} { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; clip-path: inset(100%) !important; }`,
          sheet.cssRules.length
        );
      }
    } catch (e) {
      // Selector may be invalid — fail silently
    }
  }
})();
