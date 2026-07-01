"""
Debug script — prints all equity holdings and weights for given ISINs,
then shows the overlap calculation step by step so you can verify manually.

Run from backend/ directory:
    python debug_overlap.py

Edit ISINS below to the funds you want to inspect.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from models.database import SessionLocal, FundHolding, DailyFundData

# ── Edit these ISINs ──────────────────────────────────────────────────────────
ISINS = [
    "INF109K01BL4",   # ICICI Prudential Large Cap
    "INF879O01019",   # Parag Parikh Flexi Cap
     "INF247L01965", 
     "INF247L01411",# Add more ISINs here
]
# ─────────────────────────────────────────────────────────────────────────────


def get_fund_name(db, isin):
    row = db.query(DailyFundData.name).filter(
        DailyFundData.isin == isin
    ).order_by(DailyFundData.data_date.desc()).first()
    return row[0] if row else isin


def get_equity_holdings(db, isin):
    """Returns {holding_isin: {name, weight}} for equity holdings only."""
    latest = (
        db.query(FundHolding.portfolio_date)
        .filter(FundHolding.isin == isin)
        .order_by(FundHolding.portfolio_date.desc())
        .first()
    )
    if not latest:
        return {}, None

    rows = db.query(FundHolding).filter(
        FundHolding.isin == isin,
        FundHolding.portfolio_date == latest[0],
        FundHolding.holding_type == "E",
        FundHolding.holding_isin != None,
        FundHolding.weighting != None,
        FundHolding.weighting > 0,
    ).order_by(FundHolding.weighting.desc()).all()

    holdings = {
        r.holding_isin: {
            "name": r.name,
            "weight": round(float(r.weighting), 4),
            "sector": r.global_sector or "—",
        }
        for r in rows
    }
    return holdings, latest[0]


def print_separator(char="─", width=90):
    print(char * width)


def main():
    db = SessionLocal()

    try:
        fund_data = {}

        # ── Print holdings for each fund ─────────────────────────────────────
        for isin in ISINS:
            name = get_fund_name(db, isin)
            holdings, pdate = get_equity_holdings(db, isin)

            print()
            print_separator("═")
            print(f"  {name}")
            print(f"  ISIN: {isin}  |  Portfolio date: {pdate}  |  Equity holdings: {len(holdings)}")
            print_separator("═")

            if not holdings:
                print("  No equity holdings found in DB. Run fetch_holdings_for_funds.py first.")
                continue

            print(f"  {'#':<4} {'Stock':<45} {'Sector':<25} {'Weight':>8}")
            print_separator()
            for i, (h_isin, h) in enumerate(holdings.items(), 1):
                print(f"  {i:<4} {h['name'][:44]:<45} {h['sector'][:24]:<25} {h['weight']:>7.2f}%")
            print_separator()
            print(f"  Total equity weight: {sum(h['weight'] for h in holdings.values()):.2f}%")

            fund_data[isin] = {"name": name, "holdings": holdings}

        # ── Pairwise overlap calculation ──────────────────────────────────────
        if len(ISINS) < 2:
            return

        print()
        print_separator("═")
        print("  OVERLAP ANALYSIS")
        print_separator("═")

        for i in range(len(ISINS)):
            for j in range(i + 1, len(ISINS)):
                isin_a, isin_b = ISINS[i], ISINS[j]
                fd_a = fund_data.get(isin_a)
                fd_b = fund_data.get(isin_b)
                if not fd_a or not fd_b:
                    continue

                h_a = fd_a["holdings"]
                h_b = fd_b["holdings"]
                name_a = fd_a["name"].split()[:3]
                name_b = fd_b["name"].split()[:3]
                label_a = " ".join(name_a)
                label_b = " ".join(name_b)

                common = set(h_a.keys()) & set(h_b.keys())

                print()
                print(f"  {label_a}  ×  {label_b}")
                print_separator()
                print(f"  Common stocks: {len(common)}")
                print()
                print(f"  {'Stock':<45} {label_a[:18]:>18} {label_b[:18]:>18} {'Min':>8} {'Counted?':>10}")
                print_separator()

                overlap_sum = 0.0
                rows = []
                for h_isin in common:
                    wa = h_a[h_isin]["weight"]
                    wb = h_b[h_isin]["weight"]
                    mn = min(wa, wb)
                    overlap_sum += mn
                    rows.append((mn, h_a[h_isin]["name"], wa, wb, mn))

                rows.sort(reverse=True)  # sort by min weight desc
                for mn, name, wa, wb, minimum in rows:
                    print(f"  {name[:44]:<45} {wa:>17.2f}% {wb:>17.2f}% {minimum:>7.2f}%      ✓")

                print_separator()
                print(f"  {'TOTAL OVERLAP (sum of minimums)':<45} {'':>18} {'':>18} {overlap_sum:>7.2f}%")
                print()

                # Also show Jaccard for comparison
                all_stocks = set(h_a.keys()) | set(h_b.keys())
                jaccard = len(common) / len(all_stocks) * 100 if all_stocks else 0
                print(f"  For reference:")
                print(f"    Minimum weight method (what app shows): {overlap_sum:.2f}%")
                print(f"    Jaccard (stock count method):           {jaccard:.2f}%  ({len(common)} common / {len(all_stocks)} total unique stocks)")

        # ── Only-in-each-fund stocks ──────────────────────────────────────────
        if len(ISINS) == 2:
            isin_a, isin_b = ISINS[0], ISINS[1]
            if isin_a in fund_data and isin_b in fund_data:
                h_a = fund_data[isin_a]["holdings"]
                h_b = fund_data[isin_b]["holdings"]
                only_a = {k: v for k, v in h_a.items() if k not in h_b}
                only_b = {k: v for k, v in h_b.items() if k not in h_a}

                print()
                print_separator("═")
                print(f"  UNIQUE TO {' '.join(fund_data[isin_a]['name'].split()[:3]).upper()} ({len(only_a)} stocks)")
                print_separator()
                for h_isin, h in sorted(only_a.items(), key=lambda x: -x[1]['weight'])[:15]:
                    print(f"  {h['name'][:44]:<45} {h['weight']:>7.2f}%")

                print()
                print_separator("═")
                print(f"  UNIQUE TO {' '.join(fund_data[isin_b]['name'].split()[:3]).upper()} ({len(only_b)} stocks)")
                print_separator()
                for h_isin, h in sorted(only_b.items(), key=lambda x: -x[1]['weight'])[:15]:
                    print(f"  {h['name'][:44]:<45} {h['weight']:>7.2f}%")

    finally:
        db.close()


if __name__ == "__main__":
    main()