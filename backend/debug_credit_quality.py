"""
Debug script for credit quality composition of specific funds.
Run from buglerock-analytics/backend/:

    python debug_credit_quality.py ISIN1 ISIN2 ISIN3 --weights 40 35 25

Shows:
  - Each fund's bond holdings with credit rating and weight
  - Old calculation (buggy) vs new calculation (fixed)
  - Where Not Rated is coming from
"""
import os, sys, argparse
from collections import defaultdict
from dotenv import load_dotenv
load_dotenv()

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models.database import SessionLocal, FundHolding, DailyFundData
from sqlalchemy import text

CQ_MAP = {
    'sovereign': 'AAA / Equiv', 'crisil aaa': 'AAA / Equiv', 'icra aaa': 'AAA / Equiv',
    'care aaa': 'AAA / Equiv', 'ind aaa': 'AAA / Equiv',
    'crisil aa+': 'AA', 'crisil aa': 'AA', 'crisil aa-': 'AA',
    'icra aa+': 'AA', 'icra aa': 'AA', 'icra aa-': 'AA',
    'care aa+': 'AA', 'care aa': 'AA', 'care aa-': 'AA',
    'ind aa+': 'AA', 'ind aa': 'AA', 'ind aa-': 'AA',
    'crisil a+': 'A', 'crisil a': 'A', 'crisil a-': 'A',
    'icra a+': 'A', 'icra a': 'A', 'icra a-': 'A',
    'care a+': 'A', 'care a': 'A', 'care a-': 'A',
    'crisil bbb': 'BBB', 'icra bbb': 'BBB', 'care bbb': 'BBB',
    'crisil bb': 'BB', 'icra bb': 'BB',
    'crisil b': 'B', 'icra b': 'B',
}
CQ_SCORE = {'AAA / Equiv': 7, 'AA': 6, 'A': 5, 'BBB': 4, 'BB': 3, 'B': 2, 'Below B': 1, 'Not Rated': 0}
BOND_TYPES = ['B', 'BT', 'BD', 'DS', 'CR', 'CA']
GOVT_TYPES = {'BT', 'BD', 'DS'}

def fmt(v, w=8):
    return f"{v:{w}.2f}%" if isinstance(v, float) else f"{str(v):{w}}"

def analyse_fund(db, isin, port_weight, bond_pct):
    rows = db.query(FundHolding).filter(
        FundHolding.isin == isin,
        FundHolding.holding_type.in_(BOND_TYPES),
        FundHolding.weighting != None,
        FundHolding.weighting > 0,
    ).order_by(FundHolding.weighting.desc()).all()

    # Get fund name
    fund = db.execute(text(
        "SELECT name FROM daily_fund_data WHERE isin = :isin LIMIT 1"
    ), {"isin": isin}).fetchone()
    name = fund[0] if fund else isin

    eff_w = (port_weight / 100.0) * (bond_pct / 100.0)
    holding_sum = sum(float(r.weighting) for r in rows)

    print(f"\n{'='*90}")
    print(f"FUND: {name} ({isin})")
    print(f"  Portfolio weight: {port_weight}%  |  Bond pct: {bond_pct}%  |  Effective debt weight: {eff_w*100:.2f}%")
    print(f"  Bond holdings fetched: {len(rows)}  |  Sum of fetched bond weights: {holding_sum:.2f}%")
    print(f"{'='*90}")
    print(f"  {'Type':5} {'Weight':8} {'CQ Raw':<30} {'Bucket':<15} {'OLD contrib':>12} {'NEW contrib':>12}")
    print(f"  {'-'*90}")

    cq_old = defaultdict(float)
    cq_new = defaultdict(float)

    for r in rows:
        h_wt = float(r.weighting)
        cq_raw = (r.indian_credit_quality or '').lower().strip()

        # Bucket assignment
        if not cq_raw:
            bucket = 'AAA / Equiv' if r.holding_type in GOVT_TYPES else 'Not Rated'
            cq_raw_display = f'(blank) → {bucket}'
        else:
            bucket = CQ_MAP.get(cq_raw, 'Not Rated')
            cq_raw_display = cq_raw

        # OLD: divide by holding_sum
        old_contrib = (h_wt / holding_sum) * eff_w * 100 if holding_sum > 0 else 0
        # NEW: divide by 100
        new_contrib = (h_wt / 100.0) * eff_w * 100

        cq_old[bucket] += old_contrib
        cq_new[bucket] += new_contrib

        if h_wt > 0.1:  # only show meaningful holdings
            print(f"  {r.holding_type:5} {h_wt:7.2f}%  {cq_raw_display:<30} {bucket:<15} {old_contrib:>11.3f}% {new_contrib:>11.3f}%")

    print(f"\n  SUMMARY BY BUCKET:")
    print(f"  {'Bucket':<15} {'OLD':>10} {'NEW':>10} {'Δ':>10}")
    all_buckets = sorted(set(list(cq_old.keys()) + list(cq_new.keys())))
    for b in all_buckets:
        delta = cq_new.get(b, 0) - cq_old.get(b, 0)
        print(f"  {b:<15} {cq_old.get(b,0):>9.2f}% {cq_new.get(b,0):>9.2f}% {delta:>+9.2f}%")

    return cq_old, cq_new, eff_w

def main():
    parser = argparse.ArgumentParser(description='Debug credit quality for specific funds')
    parser.add_argument('isins', nargs='+', help='Fund ISINs')
    parser.add_argument('--weights', nargs='+', type=float, help='Portfolio weights (default: equal weight)')
    parser.add_argument('--bond_pcts', nargs='+', type=float, help='Bond pct per fund (default: from snapshot)')
    args = parser.parse_args()

    isins = args.isins
    n = len(isins)
    weights = args.weights if args.weights else [100/n]*n
    if len(weights) != n:
        print(f"ERROR: {len(weights)} weights given but {n} ISINs"); sys.exit(1)

    db = SessionLocal()
    try:
        # Get bond_pct from snapshot if not provided
        bond_pcts = args.bond_pcts if args.bond_pcts else []
        if not bond_pcts:
            for isin in isins:
                row = db.execute(text(
                    "SELECT bond_pct, asset_class FROM daily_fund_data WHERE isin = :isin "
                    "ORDER BY data_date DESC LIMIT 1"
                ), {"isin": isin}).fetchone()
                if row:
                    ac = (row[1] or '').lower()
                    bp = float(row[0]) if row[0] else 0
                    # Pure debt funds = 100% bond
                    if 'debt' in ac or 'bond' in ac or 'money market' in ac:
                        bp = 100.0
                    bond_pcts.append(bp)
                    print(f"  Auto bond_pct for {isin}: {bp:.1f}% (asset_class={row[1]})")
                else:
                    bond_pcts.append(0)
                    print(f"  WARNING: No snapshot found for {isin}")

        print(f"\nAnalysing {n} funds | Weights: {weights} | Bond pcts: {bond_pcts}")

        # Analyse each fund
        all_cq_old = defaultdict(float)
        all_cq_new = defaultdict(float)
        total_debt_w = 0

        for isin, w, bp in zip(isins, weights, bond_pcts):
            cq_old, cq_new, eff_w = analyse_fund(db, isin, w, bp)
            for b, v in cq_old.items(): all_cq_old[b] += v
            for b, v in cq_new.items(): all_cq_new[b] += v
            total_debt_w += eff_w * 100

        # Portfolio-level summary
        print(f"\n{'='*90}")
        print(f"PORTFOLIO SUMMARY (total debt weight: {total_debt_w:.2f}%)")
        print(f"{'='*90}")
        print(f"{'Bucket':<15} {'OLD %':>10} {'NEW %':>10} {'Δ':>10}")

        from collections import OrderedDict
        ORDER = ['AAA / Equiv', 'AA', 'A', 'BBB', 'BB', 'B', 'Below B', 'Not Rated']
        for b in ORDER:
            old_pct = all_cq_old.get(b, 0) / total_debt_w * 100 if total_debt_w > 0 else 0
            new_pct = all_cq_new.get(b, 0) / total_debt_w * 100 if total_debt_w > 0 else 0
            print(f"  {b:<15} {old_pct:>9.1f}% {new_pct:>9.1f}% {new_pct-old_pct:>+9.1f}%")

        # Avg CQ
        old_avg = sum(CQ_SCORE.get(b,0)*v for b,v in all_cq_old.items()) / total_debt_w if total_debt_w else 0
        new_avg = sum(CQ_SCORE.get(b,0)*v for b,v in all_cq_new.items()) / total_debt_w if total_debt_w else 0

        def score_to_label(s):
            return ('AAA' if s>=6.5 else 'AA+' if s>=5.5 else 'AA' if s>=5 else
                    'AA-' if s>=4.5 else 'A' if s>=4 else 'BBB' if s>=3 else 'BB' if s>=2 else 'B')

        print(f"\n  Avg CQ (OLD): {old_avg:.3f} → {score_to_label(old_avg)}")
        print(f"  Avg CQ (NEW): {new_avg:.3f} → {score_to_label(new_avg)}")

    finally:
        db.close()

if __name__ == '__main__':
    main()