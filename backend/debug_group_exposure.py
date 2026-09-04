"""
debug_group_exposure.py
═══════════════════════════════════════════════════════════════════════════════
Fetches Morningstar holdings for a portfolio of funds and computes:
  1. Weighted-average % exposure to each HDFC / ICICI group entity
  2. Total HDFC group exposure, total ICICI group exposure
  3. Per-fund breakdown showing each entity's weight in that fund
  4. CSV + JSON outputs for further analysis

HDFC entities tracked:
  - HDFC Bank
  - HDFC AMC (HDFC Asset Management)
  - HDFC Life Insurance
  - HDB Financial Services

ICICI entities tracked:
  - ICICI Bank
  - ICICI Prudential AMC
  - ICICI Prudential Life Insurance
  - ICICI Lombard General Insurance
  - ICICI Securities

Usage:
    cd backend
    python debug_group_exposure.py
═══════════════════════════════════════════════════════════════════════════════
"""

import os, sys, json, time, re
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")
import requests

# ══════════════════════════════════════════════════════════════════════════════
# PORTFOLIO  — ISINs + weights (%) from Excel
# ══════════════════════════════════════════════════════════════════════════════
PORTFOLIO = [
    # (ISIN,                 weight_pct)   — from uploaded Excel, Weights column
    ("INF179K01AS4",  0.89),
    ("INF109K01BH2",  5.00),
    ("INF179K01AM7", 16.42),
    ("INF200KA1DA4",  8.04),
    ("INF109KA14I5", 14.41),
    ("INF174K01C78", 15.99),
    ("INF109KC1RE6",  5.87),
    ("INF879O01019",  3.20),
    ("INF179K01608",  5.87),
    ("INF247L01AH0",  1.33),
    ("INF247L01700",  1.33),
    ("INF205K01247",  4.67),
    ("INF109K01BL4",  0.83),
    ("INF204K01489",  0.16),
    ("INF740K01557",  4.22),
    ("INF109K01BH2",  0.27),
    ("INF109K01761",  6.40),
    ("INF194K01391",  0.19),
    ("INF194K01391",  0.13),
    ("INF174KA1HS9",  1.00),
    ("INF109K01AF8",  0.16),
    ("INF109K01AF8",  0.27),
    ("INF194K01JU0",  3.32),
]

ACCESS_CODE   = os.getenv("MSTAR_ACCESSCODE", "")
BASE_URL      = "https://api.morningstar.com/v2/service"
MF_BASE       = f"{BASE_URL}/mf"
HOLDINGS_API  = "v4glpjr2u59vnr12"
RATE_LIMIT    = 2
TIMEOUT       = 20

# ══════════════════════════════════════════════════════════════════════════════
# ENTITY DEFINITIONS
# Each entity has:
#   group   — "HDFC" or "ICICI"
#   label   — display name
#   isins   — known ISINs of this stock (NSE equity ISIN, used as exact match)
#   patterns — regex fallbacks on holding Name field
# ══════════════════════════════════════════════════════════════════════════════
ENTITIES = [
    # ── HDFC Group ──────────────────────────────────────────────────────────
    {
        "key":      "hdfc_bank",
        "group":    "HDFC",
        "label":    "HDFC Bank",
        "isins":    {"INE040A01034"},
        "patterns": [r"\bhdfc\s+bank\b"],
    },
    {
        "key":      "hdfc_amc",
        "group":    "HDFC",
        "label":    "HDFC AMC",
        "isins":    {"INE127D01025"},
        "patterns": [r"\bhdfc\s+asset\s+management\b", r"\bhdfc\s+amc\b"],
    },
    {
        "key":      "hdfc_life",
        "group":    "HDFC",
        "label":    "HDFC Life Insurance",
        "isins":    {"INE795G01014"},
        "patterns": [r"\bhdfc\s+life\b", r"\bhdfc\s+standard\s+life\b"],
    },
    {
        "key":      "hdb_financial",
        "group":    "HDFC",
        "label":    "HDB Financial Services",
        "isins":    {"INE756I01021"},          # unlisted; ISIN may not appear
        "patterns": [r"\bhdb\s+financial\b"],
    },
    # ── ICICI Group ─────────────────────────────────────────────────────────
    {
        "key":      "icici_bank",
        "group":    "ICICI",
        "label":    "ICICI Bank",
        "isins":    {"INE090A01021"},
        "patterns": [r"\bicici\s+bank\b"],
    },
    {
        "key":      "icici_pru_amc",
        "group":    "ICICI",
        "label":    "ICICI Prudential AMC",
        "isins":    {"INE726G01019"},
        "patterns": [r"\bicici\s+prudential\s+asset\b", r"\bicici\s+pru.*amc\b",
                     r"\bicici\s+prudential\s+amc\b"],
    },
    {
        "key":      "icici_pru_life",
        "group":    "ICICI",
        "label":    "ICICI Prudential Life Insurance",
        "isins":    {"INE726G01019"},           # check — life vs AMC have different ISINs
        "patterns": [r"\bicici\s+prudential\s+life\b", r"\bicici\s+pru.*life\b"],
    },
    {
        "key":      "icici_lombard",
        "group":    "ICICI",
        "label":    "ICICI Lombard General Insurance",
        "isins":    {"INE765G01017"},
        "patterns": [r"\bicici\s+lombard\b"],
    },
]

# Pre-compile patterns
for e in ENTITIES:
    e["_re"] = [re.compile(p, re.IGNORECASE) for p in e["patterns"]]


def match_entity(name: str, isin: str, ticker: str) -> str | None:
    """Return entity key if the holding matches any entity, else None."""
    for e in ENTITIES:
        # Exact ISIN match (most reliable)
        if isin and isin in e["isins"]:
            return e["key"]
        # Regex on name
        for r in e["_re"]:
            if name and r.search(name):
                return e["key"]
        # Regex on ticker as last resort
        for r in e["_re"]:
            if ticker and r.search(ticker):
                return e["key"]
    return None


# ══════════════════════════════════════════════════════════════════════════════
# API
# ══════════════════════════════════════════════════════════════════════════════
def fetch_portfolio(isin: str, accesscode: str) -> dict | None:
    url    = f"{MF_BASE}/{HOLDINGS_API}/ISIN/{isin}"
    params = {"accesscode": accesscode, "format": "json"}
    try:
        r = requests.get(url, params=params, timeout=TIMEOUT)
        if r.status_code != 200:
            print(f"  ✗ HTTP {r.status_code}  {r.text[:200]}")
            return None
        body   = r.json()
        status = body.get("status", {})
        if status.get("code") != 0:
            print(f"  ✗ API error {status.get('code')}: {status.get('message')}")
            return None
        data = body.get("data", [])
        if not data:
            print(f"  ✗ Empty data — ISIN not found in Morningstar")
            print(f"    Raw: {r.text[:400]}")
            return None
        api = data[0].get("api", {})
        fhv2 = api.get("FHV2-HoldingDetail")
        t25  = api.get("T25H-HoldingDetail")
        if not fhv2 and not t25:
            print(f"  ✗ No holdings block. Keys: {[k for k in api if 'Hold' in k or 'Date' in k]}")
            print(f"    Raw snippet: {r.text[:400]}")
        return api
    except Exception as e:
        print(f"  ✗ Exception: {e}")
        return None


def extract_holdings(api: dict) -> list[dict]:
    raw = api.get("FHV2-HoldingDetail") or api.get("T25H-HoldingDetail") or []
    out = []
    for h in raw:
        try:
            wt = float(h.get("Weighting") or 0)
        except (TypeError, ValueError):
            wt = 0.0
        out.append({
            "name":   h.get("Name",        ""),
            "isin":   h.get("ISIN",        ""),
            "ticker": h.get("Ticker",      ""),
            "type":   h.get("HoldingType", ""),
            "weight": wt,
        })
    return out


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
def run():
    if not ACCESS_CODE:
        print("ERROR: MSTAR_ACCESSCODE not set in .env")
        sys.exit(1)

    total_wt = sum(wt for _, wt in PORTFOLIO)
    W = 76   # print width

    print(f"\n{'═'*W}")
    print(f"  HDFC + ICICI Group — Stock-Level Exposure Analyser")
    print(f"  {len(PORTFOLIO)} funds  |  weights sum: {total_wt:.2f}%")
    print(f"{'═'*W}\n")

    # entity_key → cumulative weighted portfolio exposure (%)
    entity_exposure: dict[str, float] = defaultdict(float)

    # fund_isin → {entity_key → weight_in_fund %}
    fund_entity: dict[str, dict] = {}

    # all matched appearances for CSV
    all_matches = []

    per_fund_results = []
    raw_dump = {}

    for idx, (isin, wt) in enumerate(PORTFOLIO, 1):
        port_wt = wt / total_wt * 100   # normalised weight in portfolio
        print(f"[{idx:02d}/{len(PORTFOLIO)}] {isin}  (wt: {wt:.2f}%  norm: {port_wt:.2f}%)")

        api = fetch_portfolio(isin, ACCESS_CODE)
        if not api:
            per_fund_results.append({"isin": isin, "wt": wt, "port_wt": port_wt,
                                     "fund_name": isin, "n_holdings": 0,
                                     "pdate": "—", "entity_wts": {}, "status": "FAILED"})
            time.sleep(1 / RATE_LIMIT)
            continue

        fund_name = (api.get("FSCBI-LegalName") or api.get("DP-LegalName") or isin)
        pdate     = api.get("FHV2-PortfolioDate") or api.get("T25H-PortfolioDate") or "?"
        raw_dump[isin] = {k: v for k, v in api.items() if "Holding" not in k}

        holdings  = extract_holdings(api)
        print(f"       {fund_name[:58]:<58}  {len(holdings)} holdings  [{pdate}]")

        entity_wts: dict[str, float] = defaultdict(float)
        for h in holdings:
            ekey = match_entity(h["name"], h["isin"], h["ticker"])
            if ekey:
                entity_wts[ekey] += h["weight"]
                all_matches.append({
                    "fund_isin":   isin,
                    "fund_name":   fund_name,
                    "fund_port_wt": port_wt,
                    "entity_key":  ekey,
                    "holding_name": h["name"],
                    "holding_isin": h["isin"],
                    "weight_in_fund": h["weight"],
                    "port_contrib":  port_wt * h["weight"] / 100,
                })

        # Accumulate into portfolio totals
        for ekey, ew in entity_wts.items():
            entity_exposure[ekey] += port_wt * ew / 100

        fund_entity[isin] = dict(entity_wts)
        per_fund_results.append({
            "isin": isin, "wt": wt, "port_wt": port_wt,
            "fund_name": fund_name, "n_holdings": len(holdings),
            "pdate": pdate, "entity_wts": dict(entity_wts), "status": "OK",
        })

        if entity_wts:
            for ekey, ew in sorted(entity_wts.items()):
                elabel = next(e["label"] for e in ENTITIES if e["key"] == ekey)
                print(f"         ↳ {elabel:<38}  {ew:.2f}% in fund  |  "
                      f"{port_wt*ew/100:.3f}% portfolio contrib")

        time.sleep(1 / RATE_LIMIT)

    # ── Section 1: Portfolio-level entity summary ──────────────────────────
    hdfc_entities  = [e for e in ENTITIES if e["group"] == "HDFC"]
    icici_entities = [e for e in ENTITIES if e["group"] == "ICICI"]

    total_hdfc  = sum(entity_exposure.get(e["key"], 0) for e in hdfc_entities)
    total_icici = sum(entity_exposure.get(e["key"], 0) for e in icici_entities)

    print(f"\n{'═'*W}")
    print(f"  PORTFOLIO EXPOSURE — STOCK-LEVEL  (weighted avg across all funds)")
    print(f"{'═'*W}")
    print(f"\n  {'Entity':<40} {'Group':>6}  {'Wt-Avg Exposure':>16}")
    print(f"  {'-'*65}")
    for group_label, entities in [("HDFC", hdfc_entities), ("ICICI", icici_entities)]:
        for e in entities:
            exp = entity_exposure.get(e["key"], 0)
            bar = "█" * int(exp * 2)
            print(f"  {e['label']:<40} {group_label:>6}  {exp:>8.3f}%   {bar}")
        subtotal = sum(entity_exposure.get(e["key"], 0) for e in entities)
        print(f"  {'─'*65}")
        print(f"  {'Total ' + group_label + ' Group':<40} {group_label:>6}  {subtotal:>8.3f}%")
        print()

    print(f"  {'COMBINED HDFC + ICICI TOTAL':<40}        {total_hdfc+total_icici:>8.3f}%")

    # ── Section 2: Per-fund table ──────────────────────────────────────────
    all_ekeys = [e["key"] for e in ENTITIES]
    col_labels = {
        "hdfc_bank":      "HDFC Bank",
        "hdfc_amc":       "HDFC AMC",
        "hdfc_life":      "HDFC Life Ins",
        "hdb_financial":  "HDB Financial",
        "icici_bank":     "ICICI Bank",
        "icici_pru_amc":  "ICICI Pru AMC",
        "icici_pru_life": "ICICI Pru Life",
        "icici_lombard":  "ICICI Lombard",
    }
    COL_W = 15   # width per entity column

    print(f"\n{'═'*120}")
    print("  PER-FUND BREAKDOWN  (% weight of each entity within that fund)")
    print(f"{'═'*120}")

    # Header row 1 — fixed cols
    h1 = f"  {'ISIN':<14}  {'Fund Name':<40}  {'Wt%':>5}  {'As of':<12}  "
    # Entity cols
    for ek in all_ekeys:
        h1 += f"{col_labels[ek]:^{COL_W}}"
    h1 += f"  {'HDFC Tot':>{COL_W-1}}  {'ICICI Tot':>{COL_W-1}}  {'Status'}"
    print(h1)
    print("  " + "─" * (len(h1) - 2))

    for r in per_fund_results:
        ew       = r["entity_wts"]
        fname    = r["fund_name"] if r["fund_name"] and r["fund_name"] != r["isin"] else r.get("fund_name", r["isin"])
        fname    = fname[:40]
        row      = f"  {r['isin']:<14}  {fname:<40}  {r['wt']:>4.1f}%  {r.get('pdate','—'):<12}  "
        for ek in all_ekeys:
            v = ew.get(ek, 0)
            cell = f"{v:.2f}%" if v else "—"
            row += f"{cell:^{COL_W}}"
        hg = sum(ew.get(e["key"], 0) for e in hdfc_entities)
        ig = sum(ew.get(e["key"], 0) for e in icici_entities)
        row += f"  {hg:>{COL_W-1}.2f}%  {ig:>{COL_W-1}.2f}%  {r['status']}"
        print(row)

    # ── CSV export of per-fund table ───────────────────────────────────────
    table_csv_path = Path(__file__).parent / "debug_group_exposure_table.csv"
    with open(table_csv_path, "w") as f:
        # Header
        header_cols = ["ISIN", "Fund Name", "Weight %", "Holdings As of"]
        for ek in all_ekeys:
            header_cols.append(col_labels[ek] + " %")
        header_cols += ["HDFC Group Total %", "ICICI Group Total %", "Status"]
        f.write(",".join(header_cols) + "\n")
        # Rows
        for r in per_fund_results:
            ew    = r["entity_wts"]
            fname = r["fund_name"] if r["fund_name"] and r["fund_name"] != r["isin"] else r["isin"]
            hg    = sum(ew.get(e["key"], 0) for e in hdfc_entities)
            ig    = sum(ew.get(e["key"], 0) for e in icici_entities)
            row_vals = [r["isin"], _csv(fname), f"{r['wt']:.2f}", r.get("pdate", "")]
            for ek in all_ekeys:
                row_vals.append(f"{ew.get(ek, 0):.4f}" if ew.get(ek, 0) else "0")
            row_vals += [f"{hg:.4f}", f"{ig:.4f}", r["status"]]
            f.write(",".join(row_vals) + "\n")
    print(f"\n  Per-fund table CSV → {table_csv_path.name}")

    # ── Section 3: Entity exposure ranked ─────────────────────────────────
    print(f"\n{'═'*W}")
    print("  ENTITY EXPOSURE RANKED  (portfolio weighted-average %)")
    print(f"{'═'*W}")
    ranked = sorted(
        [(e["label"], e["group"], entity_exposure.get(e["key"], 0)) for e in ENTITIES],
        key=lambda x: -x[2]
    )
    for label, grp, exp in ranked:
        if exp > 0:
            bar = "█" * max(1, int(exp * 3))
            print(f"  {label:<42} {grp:<6}  {exp:.3f}%  {bar}")

    # ── Section 4: Outputs ─────────────────────────────────────────────────
    dump_path = Path(__file__).parent / "debug_group_exposure_raw.json"
    with open(dump_path, "w") as f:
        json.dump(raw_dump, f, indent=2, default=str)

    csv_path = Path(__file__).parent / "debug_group_exposure_matches.csv"
    with open(csv_path, "w") as f:
        f.write("fund_isin,fund_name,fund_port_wt,entity_key,entity_label,group,"
                "holding_name,holding_isin,weight_in_fund,port_contrib\n")
        for m in sorted(all_matches, key=lambda x: (-x["port_contrib"])):
            elabel = next(e["label"] for e in ENTITIES if e["key"] == m["entity_key"])
            egrp   = next(e["group"] for e in ENTITIES if e["key"] == m["entity_key"])
            f.write(f"{m['fund_isin']},{_csv(m['fund_name'])},{m['fund_port_wt']:.4f},"
                    f"{m['entity_key']},{_csv(elabel)},{egrp},"
                    f"{_csv(m['holding_name'])},{m['holding_isin']},"
                    f"{m['weight_in_fund']:.4f},{m['port_contrib']:.4f}\n")

    fail_count = sum(1 for r in per_fund_results if r["status"] == "FAILED")
    print(f"\n  Funds OK: {len(PORTFOLIO)-fail_count}/{len(PORTFOLIO)}"
          + (f"  |  ⚠ {fail_count} failed" if fail_count else ""))
    print(f"  Raw API dump   → {dump_path.name}")
    print(f"  Matches CSV    → {csv_path.name}")

    # ── Final summary: group totals ────────────────────────────────────────
    print(f"\n{'═'*W}")
    print("  FINAL SUMMARY")
    print(f"{'═'*W}")
    print(f"\n  {'HDFC Group Total':<40}  {total_hdfc:>8.3f}%  of portfolio")
    for e in hdfc_entities:
        exp = entity_exposure.get(e["key"], 0)
        if exp:
            print(f"    {'↳ ' + e['label']:<38}  {exp:>8.3f}%")
    print(f"\n  {'ICICI Group Total':<40}  {total_icici:>8.3f}%  of portfolio")
    for e in icici_entities:
        exp = entity_exposure.get(e["key"], 0)
        if exp:
            print(f"    {'↳ ' + e['label']:<38}  {exp:>8.3f}%")
    print(f"\n  {'━'*50}")
    print(f"  {'HDFC + ICICI Combined':<40}  {total_hdfc+total_icici:>8.3f}%  of portfolio")
    print(f"  {'━'*50}")
    print(f"\n{'═'*W}\n")


def _csv(s):
    s = str(s or "").replace('"', '""')
    return f'"{s}"' if "," in s or '"' in s else s


if __name__ == "__main__":
    run()