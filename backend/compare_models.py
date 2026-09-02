"""
compare_models.py
-----------------
Compares two model portfolio JSON responses side by side.
Usage:
    python compare_models.py old_result.json new_result.json

Generates a clean comparison table showing:
- Methodology used
- Fund count
- Key risk metrics (std_dev, down_capture, sharpe, CVaR implied)
- Return metrics (1Y, 3Y, 5Y)
- Expense ratio
"""

import json
import sys
import os

def load(path):
    with open(path) as f:
        data = json.load(f)
    return {p['key']: p for p in data['portfolios']}

def fmt(v, suffix=''):
    if v is None:
        return '—'
    if isinstance(v, float):
        return f"{v:.2f}{suffix}"
    return f"{v}{suffix}"

def pct_change(old, new):
    """Return % change from old to new, positive = improvement label."""
    if old is None or new is None or old == 0:
        return ''
    delta = ((new - old) / abs(old)) * 100
    arrow = '↓' if delta < 0 else '↑'
    return f"{arrow}{abs(delta):.1f}%"

def compare(old_path, new_path):
    old = load(old_path)
    new = load(new_path)

    PROFILES = ['conservative', 'mod_conservative', 'balanced', 'mod_aggressive', 'aggressive']
    PROFILE_LABELS = {
        'conservative':     'Conservative',
        'mod_conservative': 'Mod Conservative',
        'balanced':         'Balanced',
        'mod_aggressive':   'Mod Aggressive',
        'aggressive':       'Aggressive',
    }

    # Metrics to compare: (field_path, label, lower_is_better)
    METRICS = [
        ('used_method',             'Method',           None),
        ('fund_count',              'Fund count',       None),
        ('blended.std_dev_3y',      'Vol 3Y (%)',       True),   # lower = better
        ('blended.down_capture_3y', 'Down Capture',     True),   # lower = better
        ('blended.sharpe_3y',       'Sharpe 3Y',        False),  # higher = better
        ('blended.sortino_3y',      'Sortino 3Y',       False),
        ('blended.alpha_3y',        'Alpha 3Y (%)',     False),
        ('blended.beta_3y',         'Beta',             None),
        ('blended.return_1y',       'Return 1Y (%)',    False),
        ('blended.return_3y',       'Return 3Y (%)',    False),
        ('blended.return_5y',       'Return 5Y (%)',    False),
        ('blended.expense_ratio',   'Expense Ratio',    True),
        ('actual.equity_pct',       'Equity %',         None),
        ('actual.debt_pct',         'Debt %',           None),
    ]

    def get_val(portfolio, path):
        parts = path.split('.')
        v = portfolio
        for p in parts:
            if v is None:
                return None
            v = v.get(p) if isinstance(v, dict) else None
        return v

    print('\n' + '═' * 100)
    print(f"  MODEL PORTFOLIO COMPARISON")
    print(f"  OLD: {os.path.basename(old_path)}")
    print(f"  NEW: {os.path.basename(new_path)}")
    print('═' * 100)

    for profile_key in PROFILES:
        old_p = old.get(profile_key, {})
        new_p = new.get(profile_key, {})
        label = PROFILE_LABELS[profile_key]

        print(f'\n  ── {label.upper()} ' + '─' * (60 - len(label)))
        print(f"  {'METRIC':<22} {'OLD':>15} {'NEW':>15} {'CHANGE':>12}  SIGNAL")
        print(f"  {'─'*22} {'─'*15} {'─'*15} {'─'*12}  {'─'*10}")

        for field, label_m, lower_is_better in METRICS:
            old_v = get_val(old_p, field)
            new_v = get_val(new_p, field)

            # Format values
            if isinstance(old_v, float):
                old_str = f"{old_v:.2f}"
                new_str = f"{new_v:.2f}" if new_v is not None else '—'
            else:
                old_str = str(old_v) if old_v is not None else '—'
                new_str = str(new_v) if new_v is not None else '—'

            # Compute change and signal
            change_str = ''
            signal = ''
            if isinstance(old_v, (int, float)) and isinstance(new_v, (int, float)):
                delta = new_v - old_v
                pct = abs(delta / old_v * 100) if old_v != 0 else 0
                direction = '↓' if delta < 0 else '↑'
                change_str = f"{direction}{pct:.1f}%"

                if lower_is_better is True:
                    signal = '✅ Better' if delta < -0.01 else ('❌ Worse' if delta > 0.01 else '═ Same')
                elif lower_is_better is False:
                    signal = '✅ Better' if delta > 0.01 else ('❌ Worse' if delta < -0.01 else '═ Same')

            print(f"  {label_m:<22} {old_str:>15} {new_str:>15} {change_str:>12}  {signal}")

    print('\n' + '═' * 100)
    print('  SUMMARY')
    print('═' * 100)

    better_count = 0
    worse_count = 0
    total_checked = 0

    vol_improvements = []
    return_changes = []

    for profile_key in PROFILES:
        old_p = old.get(profile_key, {})
        new_p = new.get(profile_key, {})
        label = PROFILE_LABELS[profile_key]

        old_vol = get_val(old_p, 'blended.std_dev_3y')
        new_vol = get_val(new_p, 'blended.std_dev_3y')
        old_ret = get_val(old_p, 'blended.return_3y')
        new_ret = get_val(new_p, 'blended.return_3y')
        old_sharpe = get_val(old_p, 'blended.sharpe_3y')
        new_sharpe = get_val(new_p, 'blended.sharpe_3y')
        old_dc = get_val(old_p, 'blended.down_capture_3y')
        new_dc = get_val(new_p, 'blended.down_capture_3y')

        print(f"\n  {label}:")
        print(f"    Method:     {get_val(old_p,'used_method')} → {get_val(new_p,'used_method')}")

        if old_vol and new_vol:
            vol_delta = new_vol - old_vol
            vol_improvements.append(vol_delta)
            sign = '✅' if vol_delta < 0 else '❌'
            print(f"    Volatility: {old_vol:.2f}% → {new_vol:.2f}% ({sign} {'+' if vol_delta>0 else ''}{vol_delta:.2f}pp)")

        if old_ret and new_ret:
            ret_delta = new_ret - old_ret
            return_changes.append(ret_delta)
            sign = '✅' if ret_delta > 0 else ('⚠️' if ret_delta > -1 else '❌')
            print(f"    Return 3Y:  {old_ret:.2f}% → {new_ret:.2f}% ({sign} {'+' if ret_delta>0 else ''}{ret_delta:.2f}pp)")

        if old_sharpe and new_sharpe:
            sh_delta = new_sharpe - old_sharpe
            sign = '✅' if sh_delta > 0 else '❌'
            print(f"    Sharpe:     {old_sharpe:.2f} → {new_sharpe:.2f} ({sign} {'+' if sh_delta>0 else ''}{sh_delta:.2f})")

        if old_dc and new_dc:
            dc_delta = new_dc - old_dc
            sign = '✅' if dc_delta < 0 else '❌'
            print(f"    Down Cap:   {old_dc:.2f} → {new_dc:.2f} ({sign} {'+' if dc_delta>0 else ''}{dc_delta:.2f})")

    print(f"\n  OVERALL:")
    if vol_improvements:
        avg_vol = sum(vol_improvements) / len(vol_improvements)
        print(f"    Avg volatility change:  {'+' if avg_vol>0 else ''}{avg_vol:.2f}pp  {'✅ Reduced' if avg_vol < 0 else '❌ Increased'}")
    if return_changes:
        avg_ret = sum(return_changes) / len(return_changes)
        print(f"    Avg return change:      {'+' if avg_ret>0 else ''}{avg_ret:.2f}pp  {'✅ Improved' if avg_ret > 0 else ('⚠️ Minor drop' if avg_ret > -1 else '❌ Significant drop')}")

    print('\n' + '═' * 100 + '\n')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python compare_models.py old_result.json new_result.json")
        sys.exit(1)
    compare(sys.argv[1], sys.argv[2])