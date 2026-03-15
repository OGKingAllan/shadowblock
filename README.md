<p align="center">
  <img src="icons/icon128.png" alt="ShadowBlock" width="128" height="128">
</p>

<h1 align="center">ShadowBlock</h1>

<p align="center">
  <strong>The ad blocker that will never sell you out.</strong>
</p>

<p align="center">
  Blocks ads on 99% of websites. Bypasses anti-adblock walls. Collects zero data. Free forever.
</p>

---

## What is ShadowBlock?

ShadowBlock is a Chrome ad blocker built from scratch on Manifest V3. It blocks ads, trackers, and annoyances across the web without collecting a single byte of your data.

## The Problem With Every Other Ad Blocker

- **Adblock Plus / AdBlock** take $63M/year from advertisers to let their ads through. A NYU study proved their "Acceptable Ads" program exposes users to **13.6% more problematic ads** than using no blocker at all. They're literally paid to not do their job.
- **uBlock Origin** was the best ad blocker ever made. Google removed it from the Chrome Web Store.
- **uBlock Origin Lite** is what's left -- a stripped-down shadow of uBO with only ~17,000 rules, no custom filters, no element picker, and most anti-adblock walls still get through.
- **Total Adblock** charges up to $8.25/month and paid a $2.5M class-action settlement for hiding auto-renewal terms.

## What ShadowBlock Actually Does

**Kills ads before they load.** 119,000+ network blocking rules intercept ad requests before your browser downloads them. Banner ads, video pre-rolls, pop-unders, interstitials -- gone. Pages load faster because the junk never even downloads.

**Gets past "please disable your ad blocker" walls.** Forbes, Wired, Fandom, and 20+ other sites detect ad blockers and lock you out. ShadowBlock has 37 built-in bypass scripts that defeat these detection systems. No second extension needed.

**Blocks YouTube ads.** Pre-roll ads, mid-roll interruptions, overlay banners, "Get YouTube Premium" nag screens, and survey popups. All handled.

**Stops trackers from following you.** Google Analytics, Facebook Pixel, and dozens of tracking scripts get blocked. 16 surrogate scripts replace them with safe stubs so websites keep working normally.

**Hides leftover ad containers.** Cosmetic filtering removes the empty boxes, "sponsored content" sections, and recommendation spam that other blockers leave behind.

**Lets you block anything you want.** Right-click any element and select "ShadowBlock: Block this element." Write custom rules. Import additional filter lists.

**Keeps itself updated.** Filter lists auto-update every 24 hours so new ad domains get caught without waiting for an extension update.

## Why ShadowBlock Wins

| What matters | ShadowBlock | The others |
|---|---|---|
| **Blocking rules** | 119,000+ rules ship with the extension | uBO Lite ships ~17,000. That's 7x fewer. |
| **Anti-adblock bypass** | Built in. Works on 20+ sites out of the box. | AdGuard needs you to install a separate extension. uBO Lite barely tries. |
| **YouTube ads** | Blocks pre-rolls, mid-rolls, overlays, upsells | uBO Lite struggles. ABP lets some through via Acceptable Ads. |
| **Custom rules** | Yes, no restrictions | uBO Lite doesn't support them. AdGuard requires Chrome Developer Mode. |
| **Element picker** | Right-click, block anything | uBO Lite removed it entirely. |
| **Takes advertiser money** | Never have. Never will. | ABP/AdBlock take $63M/year to whitelist ads. |
| **Collects your data** | Zero. Nothing. Not a byte. | ABP tracks browsing for their Acceptable Ads program. |
| **Price** | Free. No premium tier (yet). No nag screens. | Total Adblock charges $8.25/mo. ABP Premium is $4/mo. |

## Our Promise

We will never:

1. **Take money from advertisers** to let their ads through
2. **Collect your data** -- not now, not when we're big, not ever
3. **Cripple the free version** to push you into paying
4. **Use dark patterns** -- no fake timers, no confusing opt-outs, no pre-checked boxes
5. **Bundle garbage** -- no toolbars, no search engine hijacking, no antivirus upsells

If we add premium features later, the free version stays a fully functional ad blocker. We make money from features people choose to pay for -- never from advertisers paying to get unblocked.

## Install

**Chrome Web Store:** *(Coming soon -- currently in review)*

**Manual install:**
1. Download or clone this repo
2. Open `chrome://extensions` in Chrome
3. Turn on "Developer mode" (top right toggle)
4. Click "Load unpacked" and select this folder
5. Visit any website -- ads should be gone

## Privacy

Zero network requests for telemetry. No analytics. No crash reporting. No usage tracking. All filter lists are bundled inside the extension. Your browsing data never leaves your device.

[Read the full Privacy Policy](https://ogkingallan.github.io/shadowblock-privacy/)

## Under the Hood

For the technically curious:

- **Manifest V3 native** -- built for Chrome's current extension platform, not ported
- **declarativeNetRequest** -- 119,000+ static rules across 4 rulesets + 4,900 dynamic rules
- **Scriptlet engine** -- 37 injectable scripts that neutralize anti-adblock detection
- **Surrogate library** -- 16 stub scripts replacing blocked resources so sites don't break
- **YouTube module** -- dedicated content script with JSON pruning, request interception, DOM observer
- **Cosmetic engine** -- CSS injection at `document_start` with MutationObserver for dynamic ads

## License

All rights reserved. Source code provided for review and transparency.

---

<p align="center">
  Built by a solo dev who got tired of ad blockers selling out.
</p>
