# ShadowBlock

A Chrome extension (Manifest V3) ad blocker with 123K+ network rules, anti-adblock bypass for 20+ domains, cosmetic filtering, YouTube ad blocking, and a clean dark UI. Built entirely on the declarativeNetRequest API.

## Features

- **123K+ Network Rules** — Blocks ads, trackers, and annoyances using four declarativeNetRequest rulesets compiled from EasyList, EasyPrivacy, uBlock filters, and Peter Lowe's list
- **Anti-Adblock Bypass** — Defeats adblock detection walls on 20+ major sites (Forbes, Wired, NYT, and more) using scriptlet injection and targeted countermeasures
- **Cosmetic Filtering** — Hides ad containers, sticky banners, cookie consent popups, and other visual clutter via CSS-based element hiding
- **YouTube Ad Blocking** — Dedicated content script that intercepts and skips YouTube pre-roll, mid-roll, and overlay ads
- **Element Picker** — Right-click any element to create a custom cosmetic filter rule on the fly
- **Resource Redirect Stubs** — 16 redirect resources (noop scripts, transparent pixels, VAST stubs) that silently replace blocked ad scripts so pages don't break
- **Dark UI** — Clean popup and options page with per-site toggle, stats counter, and filter management
- **Auto-Updating Filters** — Background service worker periodically fetches fresh filter lists

## Installation

1. Clone this repo:
   ```
   git clone https://github.com/OGKingAllan/shadowblock.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the cloned `shadowblock` folder
5. The ShadowBlock icon will appear in your toolbar — click it to see stats and toggle blocking per site

## How It Works

ShadowBlock uses Chrome's Manifest V3 `declarativeNetRequest` API to block network requests before they reach the page. This is the modern, performant approach — rules are evaluated by Chrome's networking stack, not by JavaScript running in the page.

On top of network blocking:

- **Content scripts** run at `document_start` to inject cosmetic filters (hiding ad elements via CSS), scriptlets (neutralizing anti-adblock detection), and YouTube-specific ad interception
- **Redirect stubs** (transparent pixels, noop scripts, empty VAST XML) replace blocked resources so sites that check for script existence don't throw errors or show broken layouts
- **Anti-adblock rules** are domain-specific JSON configs that define which scriptlets to inject and which CSS selectors to hide for sites known to use adblock detection

## Tech Stack

- **Platform:** Chrome Extension (Manifest V3)
- **Ad Blocking:** `declarativeNetRequest` API with 4 static rulesets
- **Filter Sources:** EasyList, EasyPrivacy, uBlock Origin filters, Peter Lowe's ad server list, uBlock annoyances
- **Content Scripts:** Vanilla JavaScript (cosmetic filtering, scriptlet injection, YouTube blocker, element picker)
- **UI:** HTML/CSS/JS (popup + options page, dark theme)
- **Build Tools:** Python scripts for compiling filter lists into declarativeNetRequest JSON rules

## Project Structure

```
shadowblock/
├── manifest.json          # Extension manifest (MV3)
├── background/            # Service worker (stats, filter updates, context menus)
├── content/               # Content scripts (cosmetic, scriptlets, YouTube, element picker)
├── data/                  # Anti-adblock rules, cosmetic filters, scriptlet definitions
├── filters/               # Raw filter lists (EasyList, EasyPrivacy, etc.)
├── icons/                 # Extension icons (16, 48, 128px)
├── options/               # Options page (filter management, settings)
├── popup/                 # Popup UI (stats, per-site toggle)
├── rules/                 # Compiled declarativeNetRequest JSON rulesets
├── scripts/               # Build scripts (filter compiler, icon generator)
└── stubs/                 # Redirect resources (noop scripts, pixels, VAST stubs)
```

## License

MIT
