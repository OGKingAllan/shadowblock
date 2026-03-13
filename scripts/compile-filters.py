#!/usr/bin/env python3
"""
ShadowBlock Filter List Compiler
=================================
Converts ABP (Adblock Plus) filter syntax into Chrome MV3 declarativeNetRequest
JSON rules, cosmetic filter lists, and scriptlet injection lists.

Usage:
    python compile-filters.py --lists filters/easylist.txt filters/easyprivacy.txt \
        --output-dir rules/ \
        --cosmetic-output data/cosmetic-filters.json \
        --scriptlet-output data/scriptlets.json

    python compile-filters.py --download --output-dir rules/ --stats

Author: Claude (ShadowBlock project)
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DNR_MAX_RULES = 330_000          # Chrome static rule limit
DNR_REGEX_MAX = 1_000            # Chrome regex rule limit
DEFAULT_PRIORITY_BLOCK = 1
DEFAULT_PRIORITY_ALLOW = 2       # Exceptions must beat blocks
DEFAULT_PRIORITY_IMPORTANT = 3   # $important modifier

# ABP resource-type modifier -> DNR resourceTypes value
RESOURCE_TYPE_MAP = {
    "script":           "script",
    "image":            "image",
    "stylesheet":       "stylesheet",
    "css":              "stylesheet",       # alias
    "xmlhttprequest":   "xmlhttprequest",
    "xhr":              "xmlhttprequest",   # alias
    "sub_frame":        "sub_frame",
    "subdocument":      "sub_frame",
    "object":           "object",
    "object-subrequest":"object",
    "media":            "media",
    "font":             "font",
    "websocket":        "websocket",
    "ping":             "ping",
    "other":            "other",
    "popup":            "main_frame",       # popup closest DNR equivalent
    "document":         "main_frame",
    "main_frame":       "main_frame",
}

# All valid DNR resource types (for the "everything except" inverse sets)
ALL_RESOURCE_TYPES = sorted({
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
    "object", "xmlhttprequest", "ping", "media", "websocket", "other",
})

# Filter lists available for --download
FILTER_LIST_URLS = {
    "easylist.txt": "https://easylist.to/easylist/easylist.txt",
    "easyprivacy.txt": "https://easylist.to/easylist/easyprivacy.txt",
    "peter-lowe.txt": "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext",
    "ublock-filters.txt": "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
    "ublock-annoyances.txt": "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-others.txt",
    "anti-adblock.txt": "https://raw.githubusercontent.com/nickkoro02/anti-adblock-killer-filter-list/refs/heads/main/anti-adblock-killer-filters.txt",
}

# Overly broad patterns that would break too many sites
OVERLY_BROAD_PATTERNS = {
    "*", "^", "||", "/", "http", "https", "http:", "https:",
    "||*", "||^", "*^", "**",
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ParsedFilter:
    """Intermediate representation of a parsed ABP filter line."""
    raw: str
    is_exception: bool = False
    is_important: bool = False
    pattern: str = ""
    resource_types: list = field(default_factory=list)
    excluded_resource_types: list = field(default_factory=list)
    third_party: Optional[bool] = None       # True = third-party only, False = first-party only
    initiator_domains: list = field(default_factory=list)
    excluded_initiator_domains: list = field(default_factory=list)
    request_domains: list = field(default_factory=list)
    excluded_request_domains: list = field(default_factory=list)
    is_regex: bool = False
    csp: Optional[str] = None
    redirect: Optional[str] = None
    removeparam: Optional[str] = None

    @property
    def fingerprint(self) -> str:
        """Hash for deduplication."""
        key = (
            self.is_exception,
            self.pattern,
            tuple(sorted(self.resource_types)),
            self.third_party,
            tuple(sorted(self.initiator_domains)),
            tuple(sorted(self.excluded_initiator_domains)),
        )
        return hashlib.md5(str(key).encode()).hexdigest()


@dataclass
class CosmeticFilter:
    domains: list          # empty = global
    excluded_domains: list
    selector: str
    raw: str

    @property
    def fingerprint(self) -> str:
        return hashlib.md5(
            f"{','.join(sorted(self.domains))}|{self.selector}".encode()
        ).hexdigest()


@dataclass
class ScriptletFilter:
    domains: list
    excluded_domains: list
    scriptlet: str
    args: list
    raw: str


@dataclass
class CompileStats:
    total_lines: int = 0
    comments_skipped: int = 0
    cosmetic_filters: int = 0
    scriptlet_filters: int = 0
    network_parsed: int = 0
    network_converted: int = 0
    network_skipped: int = 0
    network_skipped_reasons: dict = field(default_factory=lambda: defaultdict(int))
    deduped: int = 0
    regex_rules: int = 0
    regex_capped: int = 0
    allow_rules: int = 0
    block_rules: int = 0
    output_files: dict = field(default_factory=dict)

    def summary(self) -> str:
        lines = [
            "=" * 60,
            "  ShadowBlock Filter Compiler -- Stats",
            "=" * 60,
            f"  Total lines processed:    {self.total_lines:>8,}",
            f"  Comments/headers skipped:  {self.comments_skipped:>8,}",
            f"  Cosmetic filters:          {self.cosmetic_filters:>8,}",
            f"  Scriptlet filters:         {self.scriptlet_filters:>8,}",
            f"  Network filters parsed:    {self.network_parsed:>8,}",
            f"  Network filters converted: {self.network_converted:>8,}",
            f"    +- Block rules:          {self.block_rules:>8,}",
            f"    +- Allow rules:          {self.allow_rules:>8,}",
            f"    +- Regex rules:          {self.regex_rules:>8,}",
            f"  Deduplicated:              {self.deduped:>8,}",
            f"  Skipped (unconvertible):   {self.network_skipped:>8,}",
        ]
        if self.network_skipped_reasons:
            lines.append("    Skip reasons:")
            for reason, count in sorted(self.network_skipped_reasons.items(),
                                        key=lambda x: -x[1]):
                lines.append(f"      {reason}: {count:,}")
        if self.regex_capped:
            lines.append(f"  Regex rules capped (>{DNR_REGEX_MAX}): {self.regex_capped:>6,}")
        if self.output_files:
            lines.append("")
            lines.append("  Output files:")
            for path, count in self.output_files.items():
                lines.append(f"    {path}: {count:,} rules")
        lines.append("=" * 60)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Downloader
# ---------------------------------------------------------------------------

def download_filter_lists(output_dir: str) -> list[str]:
    """Download all configured filter lists. Returns list of file paths."""
    os.makedirs(output_dir, exist_ok=True)
    paths = []
    for filename, url in FILTER_LIST_URLS.items():
        dest = os.path.join(output_dir, filename)
        print(f"  Downloading {filename}...", end=" ", flush=True)
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "ShadowBlock/1.0 Filter Compiler"
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            with open(dest, "wb") as f:
                f.write(data)
            line_count = data.count(b"\n")
            print(f"OK ({line_count:,} lines)")
            paths.append(dest)
        except (urllib.error.URLError, OSError) as e:
            print(f"FAILED: {e}")
    return paths


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def is_comment_or_header(line: str) -> bool:
    """Check if a line is a comment or ABP header."""
    return (
        line.startswith("!")
        or line.startswith("[Adblock")
        or line.startswith("[uBlock")
        or line == ""
    )


def is_cosmetic_filter(line: str) -> bool:
    """True if the line is a cosmetic (element-hiding) filter."""
    # Cosmetic: ##, #@#, #?#, #@?#  (but NOT #%# which is scriptlet, nor +js())
    # Must not be a network filter with # in URL
    if is_scriptlet_filter(line):
        return False
    if "##" in line or "#@#" in line or "#?#" in line:
        # Make sure it's not a URL pattern containing ##
        idx = line.find("##") if "##" in line else line.find("#@#") if "#@#" in line else line.find("#?#")
        if idx >= 0:
            prefix = line[:idx]
            # If prefix contains | or / or *, it's likely a network filter
            if "||" in prefix or prefix.startswith("/"):
                return False
            return True
    return False


def is_scriptlet_filter(line: str) -> bool:
    """True if the line is a scriptlet injection filter."""
    return "#%#" in line or "+js(" in line


def parse_cosmetic_filter(line: str) -> Optional[CosmeticFilter]:
    """Parse a cosmetic filter line into a CosmeticFilter."""
    # Patterns: domain1,domain2##.selector  or  ##.selector  or  domain#@#.selector
    for sep in ("#@#", "#?#", "##"):
        idx = line.find(sep)
        if idx >= 0:
            domain_part = line[:idx].strip()
            selector = line[idx + len(sep):].strip()
            if not selector:
                return None

            domains = []
            excluded = []
            if domain_part:
                for d in domain_part.split(","):
                    d = d.strip()
                    if d.startswith("~"):
                        excluded.append(d[1:])
                    elif d:
                        domains.append(d)

            return CosmeticFilter(
                domains=domains,
                excluded_domains=excluded,
                selector=selector,
                raw=line,
            )
    return None


def parse_scriptlet_filter(line: str) -> Optional[ScriptletFilter]:
    """Parse a scriptlet filter line."""
    # Pattern: domain1,~domain2#%#//scriptlet('name', 'arg1', 'arg2')
    # Pattern: domain1,domain2#+js(name, arg1, arg2)
    domains = []
    excluded = []

    if "#%#" in line:
        idx = line.index("#%#")
        domain_part = line[:idx].strip()
        scriptlet_part = line[idx + 3:].strip()
    elif "+js(" in line:
        # Find the separator: ##+js( or #@#+js(
        # uBO syntax: domain##+js(name, arg1)  or  domain#@#+js(name, arg1)
        for sep in ("#@#", "##"):
            search = sep + "+js("
            idx = line.find(search)
            if idx >= 0:
                domain_part = line[:idx].strip()
                scriptlet_part = "+js(" + line[idx + len(search):]
                break
        else:
            return None
    else:
        return None

    if domain_part:
        for d in domain_part.split(","):
            d = d.strip()
            if d.startswith("~"):
                excluded.append(d[1:])
            elif d:
                domains.append(d)

    # Extract scriptlet name and args
    name = scriptlet_part
    args = []
    # Try to parse +js(name, arg1, arg2) or //scriptlet('name', 'arg1')
    m = re.match(r"\+js\((.+)\)$", scriptlet_part)
    if m:
        parts = [p.strip().strip("'\"") for p in m.group(1).split(",")]
        name = parts[0] if parts else scriptlet_part
        args = parts[1:] if len(parts) > 1 else []
    else:
        m = re.match(r"//scriptlet\((.+)\)$", scriptlet_part)
        if m:
            parts = [p.strip().strip("'\"") for p in m.group(1).split(",")]
            name = parts[0] if parts else scriptlet_part
            args = parts[1:] if len(parts) > 1 else []

    return ScriptletFilter(
        domains=domains,
        excluded_domains=excluded,
        scriptlet=name,
        args=args,
        raw=line,
    )


def parse_modifiers(modifier_str: str, pf: ParsedFilter, stats: CompileStats) -> bool:
    """
    Parse the $modifier section of a network filter.
    Returns False if the filter should be skipped entirely.
    """
    if not modifier_str:
        return True

    for mod in modifier_str.split(","):
        mod = mod.strip()
        if not mod:
            continue

        # Negated resource types: ~script, ~image, etc.
        if mod.startswith("~") and mod[1:].lower() in RESOURCE_TYPE_MAP:
            dnr_type = RESOURCE_TYPE_MAP[mod[1:].lower()]
            if dnr_type not in pf.excluded_resource_types:
                pf.excluded_resource_types.append(dnr_type)
            continue

        # Positive resource types
        if mod.lower() in RESOURCE_TYPE_MAP:
            dnr_type = RESOURCE_TYPE_MAP[mod.lower()]
            if dnr_type not in pf.resource_types:
                pf.resource_types.append(dnr_type)
            continue

        # third-party / first-party
        if mod.lower() == "third-party":
            pf.third_party = True
            continue
        if mod.lower() in ("first-party", "~third-party", "1p"):
            pf.third_party = False
            continue
        if mod.lower() == "3p":
            pf.third_party = True
            continue

        # domain= modifier
        if mod.lower().startswith("domain="):
            domain_val = mod[7:]
            for d in domain_val.split("|"):
                d = d.strip()
                if d.startswith("~"):
                    pf.excluded_initiator_domains.append(d[1:])
                elif d:
                    pf.initiator_domains.append(d)
            continue

        # denyallow= modifier (request domains to exclude)
        if mod.lower().startswith("denyallow="):
            domain_val = mod[10:]
            for d in domain_val.split("|"):
                d = d.strip()
                if d:
                    pf.excluded_request_domains.append(d)
            continue

        # important
        if mod.lower() == "important":
            pf.is_important = True
            continue

        # match-case (DNR is case-insensitive by default, we note but allow)
        if mod.lower() == "match-case":
            continue  # DNR handles this via isUrlFilterCaseSensitive, we skip for simplicity

        # csp= (can't represent fully in DNR block rules, skip)
        if mod.lower().startswith("csp="):
            pf.csp = mod[4:]
            return False  # Skip CSP rules

        # redirect / rewrite (can't represent in DNR static rules easily)
        if mod.lower().startswith("redirect=") or mod.lower().startswith("rewrite="):
            pf.redirect = mod
            return False

        # removeparam (supported in DNR but complex)
        if mod.lower().startswith("removeparam="):
            pf.removeparam = mod[12:]
            # We could handle these but they need special DNR action type
            return False

        # badfilter (invalidates other filters, complex to implement)
        if mod.lower() == "badfilter":
            return False

        # all (all resource types)
        if mod.lower() == "all":
            pf.resource_types = list(ALL_RESOURCE_TYPES)
            continue

        # Unknown modifiers --skip to be safe
        # (includes: webrtc, genericblock, generichide, elemhide, etc.)
        # These are cosmetic/behavioral modifiers that DNR can't handle

    return True


def parse_network_filter(line: str, stats: CompileStats) -> Optional[ParsedFilter]:
    """Parse a single ABP network filter line into a ParsedFilter."""
    raw = line
    pf = ParsedFilter(raw=raw)

    # Exception rules
    if line.startswith("@@"):
        pf.is_exception = True
        line = line[2:]

    # Split pattern and modifiers at the LAST $ that looks like a modifier separator
    # Tricky: $ can appear in URLs. Heuristic: split at $ only if what follows
    # looks like known modifiers.
    pattern = line
    modifier_str = ""

    dollar_idx = _find_modifier_dollar(line)
    if dollar_idx >= 0:
        pattern = line[:dollar_idx]
        modifier_str = line[dollar_idx + 1:]

    # Parse modifiers
    if not parse_modifiers(modifier_str, pf, stats):
        stats.network_skipped += 1
        stats.network_skipped_reasons["unsupported modifier (csp/redirect/removeparam/badfilter)"] += 1
        return None

    # Clean up pattern
    pattern = pattern.strip()
    if not pattern:
        stats.network_skipped += 1
        stats.network_skipped_reasons["empty pattern"] += 1
        return None

    # Check if it's a regex filter: /regex/
    if pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 2:
        pf.is_regex = True
        pf.pattern = pattern[1:-1]  # Strip the slashes
    else:
        pf.pattern = pattern

    # Check for overly broad patterns
    if pf.pattern in OVERLY_BROAD_PATTERNS:
        stats.network_skipped += 1
        stats.network_skipped_reasons["overly broad pattern"] += 1
        return None

    return pf


def _find_modifier_dollar(line: str) -> int:
    """
    Find the index of the $ that separates the URL pattern from modifiers.
    Returns -1 if no modifier $ found.
    """
    # Known modifier keywords to detect
    known_mods = {
        "script", "image", "stylesheet", "css", "xmlhttprequest", "xhr",
        "subdocument", "sub_frame", "object", "media", "font", "websocket",
        "ping", "other", "popup", "document", "main_frame",
        "third-party", "~third-party", "first-party", "3p", "1p",
        "domain=", "denyallow=", "important", "match-case",
        "csp=", "redirect=", "rewrite=", "removeparam=", "badfilter",
        "all", "object-subrequest",
        # Negated types
        "~script", "~image", "~stylesheet", "~xmlhttprequest", "~xhr",
        "~subdocument", "~object", "~media", "~font", "~websocket",
        "~ping", "~other", "~popup", "~document",
    }

    # Search from the right for a $ where the text after looks like modifiers
    idx = len(line) - 1
    while idx >= 0:
        idx = line.rfind("$", 0, idx + 1)
        if idx < 0:
            break
        after = line[idx + 1:]
        # Check if the first token after $ is a known modifier
        first_token = after.split(",")[0].strip().lower()
        # Check prefix match for modifiers with = (like domain=example.com)
        if first_token in known_mods or any(first_token.startswith(m) for m in known_mods if "=" in m):
            return idx
        idx -= 1

    return -1


# ---------------------------------------------------------------------------
# DNR Converter
# ---------------------------------------------------------------------------

def filter_to_dnr_rule(pf: ParsedFilter, rule_id: int, stats: CompileStats) -> Optional[dict]:
    """Convert a ParsedFilter to a Chrome DNR rule dict."""
    rule = {"id": rule_id}

    # Action
    if pf.is_exception:
        priority = DEFAULT_PRIORITY_ALLOW
        if pf.is_important:
            priority = DEFAULT_PRIORITY_IMPORTANT + 1  # important exception
        rule["priority"] = priority
        rule["action"] = {"type": "allow"}
        stats.allow_rules += 1
    else:
        priority = DEFAULT_PRIORITY_BLOCK
        if pf.is_important:
            priority = DEFAULT_PRIORITY_IMPORTANT
        rule["priority"] = priority
        rule["action"] = {"type": "block"}
        stats.block_rules += 1

    # Condition
    condition = {}

    # URL matching
    if pf.is_regex:
        # Validate regex isn't too complex for Chrome
        try:
            re.compile(pf.pattern)
        except re.error:
            stats.network_skipped += 1
            stats.network_skipped_reasons["invalid regex"] += 1
            return None
        condition["regexFilter"] = pf.pattern
        condition["isUrlFilterCaseSensitive"] = False
        stats.regex_rules += 1
    else:
        # Use urlFilter --Chrome DNR supports ABP-like syntax natively:
        # || = domain anchor, ^ = separator, * = wildcard
        url_filter = pf.pattern
        # DNR urlFilter has some constraints; clean up edge cases
        # Remove trailing | (end-of-URL anchor) --DNR doesn't support it the same way
        # Actually DNR does support | as end anchor, so keep it
        condition["urlFilter"] = url_filter
        condition["isUrlFilterCaseSensitive"] = False

    # Resource types
    if pf.resource_types:
        condition["resourceTypes"] = sorted(set(pf.resource_types))
    elif pf.excluded_resource_types:
        # Compute the inverse set
        included = [t for t in ALL_RESOURCE_TYPES if t not in pf.excluded_resource_types]
        if included:
            condition["resourceTypes"] = sorted(included)
    # If neither specified, DNR matches all types by default --no need to set

    # Domain type (third-party / first-party)
    if pf.third_party is True:
        condition["domainType"] = "thirdParty"
    elif pf.third_party is False:
        condition["domainType"] = "firstParty"

    # Initiator domains ($domain=)
    if pf.initiator_domains:
        condition["initiatorDomains"] = sorted(set(pf.initiator_domains))
    if pf.excluded_initiator_domains:
        condition["excludedInitiatorDomains"] = sorted(set(pf.excluded_initiator_domains))

    # Request domains (denyallow=)
    if pf.excluded_request_domains:
        condition["excludedRequestDomains"] = sorted(set(pf.excluded_request_domains))

    rule["condition"] = condition
    return rule


# ---------------------------------------------------------------------------
# Compiler Pipeline
# ---------------------------------------------------------------------------

def compile_filter_list(
    input_files: list[str],
    output_dir: str,
    cosmetic_output: Optional[str],
    scriptlet_output: Optional[str],
    max_rules: int,
    stats: CompileStats,
) -> None:
    """Main compilation pipeline."""

    all_network_filters: list[ParsedFilter] = []
    all_cosmetic_filters: list[CosmeticFilter] = []
    all_scriptlet_filters: list[ScriptletFilter] = []
    seen_network: set[str] = set()
    seen_cosmetic: set[str] = set()

    # --- Phase 1: Parse all input files ---
    for filepath in input_files:
        if not os.path.exists(filepath):
            print(f"  WARNING: {filepath} not found, skipping.")
            continue

        print(f"  Parsing {os.path.basename(filepath)}...", end=" ", flush=True)
        file_count = 0

        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                stats.total_lines += 1

                # Skip comments and headers
                if is_comment_or_header(line):
                    stats.comments_skipped += 1
                    continue

                # Scriptlet filters (check before cosmetic since +js can contain ##)
                if is_scriptlet_filter(line):
                    sf = parse_scriptlet_filter(line)
                    if sf:
                        all_scriptlet_filters.append(sf)
                        stats.scriptlet_filters += 1
                    continue

                # Cosmetic filters
                if is_cosmetic_filter(line):
                    cf = parse_cosmetic_filter(line)
                    if cf:
                        fp = cf.fingerprint
                        if fp not in seen_cosmetic:
                            seen_cosmetic.add(fp)
                            all_cosmetic_filters.append(cf)
                            stats.cosmetic_filters += 1
                    continue

                # Network filters
                prev_skipped = stats.network_skipped
                pf = parse_network_filter(line, stats)
                if pf is None:
                    # Only count if parse_network_filter didn't already count it
                    if stats.network_skipped == prev_skipped:
                        stats.network_skipped += 1
                        stats.network_skipped_reasons["unsupported modifier"] += 1
                    continue

                stats.network_parsed += 1
                fp = pf.fingerprint
                if fp in seen_network:
                    stats.deduped += 1
                    continue
                seen_network.add(fp)
                all_network_filters.append(pf)
                file_count += 1

        print(f"{file_count:,} network rules")

    # --- Phase 2: Convert to DNR rules ---
    print(f"\n  Converting {len(all_network_filters):,} network filters to DNR...")

    # Separate regex and urlFilter rules to respect the regex cap
    regex_filters = [f for f in all_network_filters if f.is_regex]
    url_filters = [f for f in all_network_filters if not f.is_regex]

    # Prioritize urlFilter rules (no cap), then add regex up to limit
    ordered_filters = url_filters + regex_filters

    dnr_rules = []
    regex_count = 0
    rule_id = 1

    for pf in ordered_filters:
        if len(dnr_rules) >= max_rules:
            break

        if pf.is_regex:
            if regex_count >= DNR_REGEX_MAX:
                stats.regex_capped += 1
                continue
            regex_count += 1

        rule = filter_to_dnr_rule(pf, rule_id, stats)
        if rule:
            dnr_rules.append(rule)
            stats.network_converted += 1
            rule_id += 1

    # --- Phase 3: Split into output files ---
    # Strategy: categorize rules into ads/trackers/annoyances based on source list
    # For simplicity with mixed sources, output a single combined file
    # OR split by file naming convention
    os.makedirs(output_dir, exist_ok=True)

    # Write combined rules file
    combined_path = os.path.join(output_dir, "rules.json")
    _write_json(combined_path, dnr_rules)
    stats.output_files[combined_path] = len(dnr_rules)

    # Also write split files for the manifest (ads, trackers, annoyances)
    # Heuristic: split based on rule count thirds, or based on source file
    _write_split_rules(dnr_rules, output_dir, stats)

    # --- Phase 4: Write cosmetic filters ---
    if cosmetic_output and all_cosmetic_filters:
        os.makedirs(os.path.dirname(cosmetic_output) or ".", exist_ok=True)
        cosmetic_data = []
        for cf in all_cosmetic_filters:
            entry = {"selector": cf.selector}
            if cf.domains:
                entry["domains"] = cf.domains
            if cf.excluded_domains:
                entry["excludedDomains"] = cf.excluded_domains
            cosmetic_data.append(entry)
        _write_json(cosmetic_output, cosmetic_data)
        stats.output_files[cosmetic_output] = len(cosmetic_data)

    # --- Phase 5: Write scriptlet filters ---
    if scriptlet_output and all_scriptlet_filters:
        os.makedirs(os.path.dirname(scriptlet_output) or ".", exist_ok=True)
        scriptlet_data = []
        for sf in all_scriptlet_filters:
            entry = {"scriptlet": sf.scriptlet, "args": sf.args}
            if sf.domains:
                entry["domains"] = sf.domains
            if sf.excluded_domains:
                entry["excludedDomains"] = sf.excluded_domains
            scriptlet_data.append(entry)
        _write_json(scriptlet_output, scriptlet_data)
        stats.output_files[scriptlet_output] = len(scriptlet_data)

    print(f"  Done. {stats.network_converted:,} DNR rules written.")


def _write_split_rules(rules: list[dict], output_dir: str, stats: CompileStats) -> None:
    """
    Split rules into ads.json, trackers.json, annoyances.json for the manifest.
    Heuristic split:
      - Rules with resourceTypes containing only xmlhttprequest/ping/websocket → trackers
      - Rules blocking main_frame or sub_frame → annoyances
      - Everything else → ads
    Each file gets sequential IDs starting from 1.
    """
    ads = []
    trackers = []
    annoyances = []

    tracker_types = {"xmlhttprequest", "ping", "websocket"}
    annoyance_types = {"main_frame", "sub_frame"}

    for rule in rules:
        rt = set(rule.get("condition", {}).get("resourceTypes", []))

        if rt and rt.issubset(tracker_types):
            trackers.append(rule)
        elif rt and rt.issubset(annoyance_types):
            annoyances.append(rule)
        else:
            ads.append(rule)

    # Re-assign sequential IDs per file
    for i, r in enumerate(ads, 1):
        r["id"] = i
    for i, r in enumerate(trackers, 1):
        r["id"] = i
    for i, r in enumerate(annoyances, 1):
        r["id"] = i

    ads_path = os.path.join(output_dir, "ads.json")
    trackers_path = os.path.join(output_dir, "trackers.json")
    annoyances_path = os.path.join(output_dir, "annoyances.json")

    _write_json(ads_path, ads)
    _write_json(trackers_path, trackers)
    _write_json(annoyances_path, annoyances)

    stats.output_files[ads_path] = len(ads)
    stats.output_files[trackers_path] = len(trackers)
    stats.output_files[annoyances_path] = len(annoyances)


def _write_json(path: str, data: list) -> None:
    """Write a list to a JSON file, compact but readable."""
    with open(path, "w", encoding="utf-8") as f:
        # Use compact format for rule files (saves significant space)
        # but keep each rule on its own line for debuggability
        f.write("[\n")
        for i, item in enumerate(data):
            line = json.dumps(item, separators=(",", ":"), sort_keys=True)
            if i < len(data) - 1:
                f.write(f"  {line},\n")
            else:
                f.write(f"  {line}\n")
        f.write("]\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="ShadowBlock Filter Compiler -- ABP to Chrome DNR converter",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --download --output-dir rules/ --stats
  %(prog)s --lists filters/easylist.txt filters/easyprivacy.txt --output-dir rules/
  %(prog)s --lists filters/*.txt --output-dir rules/ --cosmetic-output data/cosmetic-filters.json
        """,
    )
    parser.add_argument(
        "--lists", nargs="*", default=[],
        help="ABP filter list files to compile",
    )
    parser.add_argument(
        "--download", action="store_true",
        help="Download latest filter lists to filters/ before compiling",
    )
    parser.add_argument(
        "--filters-dir", default=None,
        help="Directory for downloaded filter lists (default: filters/ next to script)",
    )
    parser.add_argument(
        "--output-dir", default="rules/",
        help="Directory for DNR JSON output (default: rules/)",
    )
    parser.add_argument(
        "--cosmetic-output", default=None,
        help="Path for cosmetic filter JSON output",
    )
    parser.add_argument(
        "--scriptlet-output", default=None,
        help="Path for scriptlet filter JSON output",
    )
    parser.add_argument(
        "--max-rules", type=int, default=DNR_MAX_RULES,
        help=f"Maximum DNR rules to output (default: {DNR_MAX_RULES:,})",
    )
    parser.add_argument(
        "--stats", action="store_true",
        help="Print detailed compilation statistics",
    )

    args = parser.parse_args()

    # Resolve paths relative to the extension root (parent of scripts/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ext_root = os.path.dirname(script_dir)

    filters_dir = args.filters_dir or os.path.join(ext_root, "filters")
    output_dir = args.output_dir
    if not os.path.isabs(output_dir):
        output_dir = os.path.join(ext_root, output_dir)
    cosmetic_output = args.cosmetic_output
    if cosmetic_output and not os.path.isabs(cosmetic_output):
        cosmetic_output = os.path.join(ext_root, cosmetic_output)
    scriptlet_output = args.scriptlet_output
    if scriptlet_output and not os.path.isabs(scriptlet_output):
        scriptlet_output = os.path.join(ext_root, scriptlet_output)

    input_files = list(args.lists)  # Explicit files take priority

    print("ShadowBlock Filter Compiler")
    print("-" * 40)

    # Download if requested
    if args.download:
        print("\nDownloading filter lists...")
        downloaded = download_filter_lists(filters_dir)
        input_files.extend(downloaded)

    # If no explicit lists and no download, try to find existing filter files
    if not input_files:
        if os.path.isdir(filters_dir):
            for f in sorted(os.listdir(filters_dir)):
                if f.endswith(".txt"):
                    input_files.append(os.path.join(filters_dir, f))

    if not input_files:
        print("ERROR: No filter lists to compile. Use --lists or --download.")
        sys.exit(1)

    print(f"\nCompiling {len(input_files)} filter list(s)...")
    stats = CompileStats()

    compile_filter_list(
        input_files=input_files,
        output_dir=output_dir,
        cosmetic_output=cosmetic_output,
        scriptlet_output=scriptlet_output,
        max_rules=args.max_rules,
        stats=stats,
    )

    if args.stats:
        print(f"\n{stats.summary()}")
    else:
        print(f"\n  Total: {stats.network_converted:,} DNR rules, "
              f"{stats.cosmetic_filters:,} cosmetic, "
              f"{stats.scriptlet_filters:,} scriptlets")

    print("\nDone.")


if __name__ == "__main__":
    main()
