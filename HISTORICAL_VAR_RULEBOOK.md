# Historical VaR — Rulebook

**Endpoint:** `GET /api/holdings/historical-var`  
**Used in:** Portfolio Builder → Analyse → Sensitivity tab (VaR table) + Portfolio X-Ray (CVaR/ES)

---

## What it computes

Value-at-Risk (VaR) and Expected Shortfall (ES) for a portfolio at 95% and 99% confidence levels across four horizons: 1 day, 1 week, 1 month, 1 year.

- **VaR:** the loss not expected to be exceeded at the stated confidence level
- **ES (CVaR):** the average loss given that VaR is breached — a more conservative tail measure

---

## Data source

`nav_history` table — daily NAV for each fund going back to inception (sourced from Morningstar primary, mfapi fallback). 3.8M+ rows, 1,973 funds, some going back to 2006.

Default lookback: **756 trading days (3 years)**. Full history available via `lookback_days=9999`.

---

## Fund classification

Each fund is classified independently based on how many trading days of NAV it has:

| NAV history | Classification |
|---|---|
| >= 504 days | Full historical for all horizons (1D/1W/1M/1Y) |
| 252–503 days | Historical for 1D/1W/1M; parametric for 1Y |
| < 252 days | Parametric fallback for all horizons |

The old partial label (252–755 days) is removed. With full history as default, every fund contributes its complete available history — no artificial cutoff. The 252/504 day thresholds are statistical minimums (need enough overlapping windows for a meaningful percentile), not lookback limits.

---

## How returns are computed

**Daily returns:**
```
return_t = (NAV_t / NAV_t-1) - 1
```

**Gap handling:** if two consecutive NAV dates are more than 7 calendar days apart, that return is skipped. This handles international funds affected by SEBI's overseas investment pause (Feb–Nov 2022), which caused large artificial one-day returns when NAV publication resumed.

**No common-dates intersection:** all Indian MFs follow the same SEBI trading calendar. If a day is a market holiday, all funds have no NAV that day — no misalignment possible. The date series of eligible funds is used directly.

---

## How portfolio VaR is computed — overlapping period returns

Instead of scaling 1D returns with √time (which assumes i.i.d. returns and misses volatility clustering), we compute **actual compounded returns** over each horizon window:

| Horizon | Window size | Overlapping windows (from 756-day lookback) |
|---|---|---|
| 1 day | 1 day | 755 |
| 1 week | 5 days | 752 |
| 1 month | 21 days | 735 |
| 1 year | 252 days | 504 |

For each window:
```
portfolio_return = Σ(fund_compounded_return_over_window × fund_weight)
fund_compounded_return = (NAV_end / NAV_start) - 1
```

All portfolio period returns are then sorted worst to best. VaR and ES are picked from the tail:

```
95% VaR = return at the 5th percentile (worst 5% of windows)
99% VaR = return at the 1st percentile (worst 1% of windows)
ES 95%  = average of all returns worse than the 95% VaR cutoff
ES 99%  = average of all returns worse than the 99% VaR cutoff
```

---

## Parametric fallback for short-history funds

Funds with < 252 days NAV (or < 504 days for the 1Y horizon) cannot contribute historically. Their weight is handled via parametric normal distribution:

```
VaR contribution = fund_weight × Z × std_dev_annual × √(horizon_days / 252)
ES contribution  = fund_weight × ES_mult × std_dev_annual × √(horizon_days / 252)

Z scores (normal distribution):
  95% VaR: Z = 1.6449
  99% VaR: Z = 2.3263
  95% ES multiplier: 2.063
  99% ES multiplier: 2.665
```

**std_dev_annual is determined by this proxy chain:**

| Priority | Source | When used |
|---|---|---|
| 1 | Fund's own `std_dev_3y` from Morningstar snapshot | Rarely available for new funds |
| 2 | Category avg `std_dev_3y` from `daily_fund_data` | Covers 99%+ of cases |
| 3 | Asset class avg `std_dev_3y` from `daily_fund_data` | New category with no peers having 3Y data |
| 4 | Hardcoded default | Safety net only — almost never fires |

**Hardcoded defaults (last resort only):**
```
Equity: 18%    Debt: 4%       Hybrid: 10%
ETF-Equity: 15%  ETF-Debt: 5%  International: 20%  Precious Metals: 22%
```

---

## Final portfolio VaR

```
Portfolio VaR = historical_contribution + parametric_contribution

historical_contribution = raw_historical_VaR × (hist_funds_weight / 100)
parametric_contribution = Σ(each_parametric_fund_contribution)
```

This blends the two methods proportionally by weight — funds with good data contribute historically, new/short-history funds contribute parametrically.

---

## Response structure

```json
{
  "method": "historical_simulation" or "hybrid",
  "var": [
    {
      "horizon": "1 month",
      "days": 21,
      "var_95": 5.82,
      "es_95": 8.36,
      "var_99": 9.48,
      "es_99": 13.86,
      "hist_funds": 12,
      "param_funds": 1,
      "common_days": 735,
      "date_from": "2023-07-18",
      "date_to": "2026-08-13"
    }
  ],
  "full_historical_funds": ["ISIN1", "ISIN2"],
  "partial_historical_funds": ["ISIN3"],
  "parametric_funds": ["ISIN4"],
  "fund_std_proxies": {
    "ISIN4": { "std": 13.4, "source": "category_avg" }
  },
  "hist_notes": ["ISIN3 (380 days — partial, < 3Y)"],
  "param_notes": ["ISIN4 (parametric, std=13.4%, source=category_avg)"]
}
```

---

## Where results are used in the frontend

| Location | Values used |
|---|---|
| Sensitivity tab → VaR table | All horizons, both parametric and historical columns side by side |
| Portfolio X-Ray → CVaR 95% | `es_95` from 1-month row |
| Portfolio X-Ray → Expected Shortfall 99% | `es_99` from 1-year row |

---

## Limitations

1. **Overlapping windows are not independent** — 735 overlapping 21-day windows share most of their data. This overstates statistical precision but does not bias the VaR estimate itself.
2. **Normal distribution for parametric** — real return distributions have fatter tails. The parametric component underestimates tail risk for new funds.
3. **No correlation adjustment** — portfolio returns are computed as weighted sums of individual returns, which correctly captures realised correlation. However, the parametric component for short-history funds does not account for correlation with other portfolio holdings.
4. **Lookback window bias** — a 3Y window ending in a calm period (e.g. 2023–2026) will give lower VaR than a window including 2020 (COVID crash). Use full history (`lookback_days=9999`) for a more conservative estimate.