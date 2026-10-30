# BugleRock Model Portfolios — Rulebook

> **Source files:** `backend/routers/models.py` · `frontend/src/components/ModelPortfolios/ModelPortfolios.jsx`  
> **Last updated:** 2026-10-27  
> Every future change to model portfolio logic must be reflected in this document alongside the code change.

---

## 1. Overview

BugleRock's model portfolios are five risk-tiered, constraint-based portfolios constructed daily from the R1/R2 ranked mutual fund universe. They are **not equal-weight** and **not manually curated** — a linear programming solver finds weights that satisfy a set of financial constraints defined per model and, within those constraints, favours higher 3Y return per unit of risk (section 6.1). Gold is a fixed allocation per model (section 6.5).

| Model | Risk | Equity (centre ±5) | Debt (centre ±5) | Fixed gold |
|---|---|---|---|---|
| Conservative | Low | 20% (15–25%) | 80% (75–85%) | 5% |
| Moderately Conservative | Low–Moderate | 30% (25–35%) | 70% (65–75%) | 5% |
| Balanced | Moderate | 50% (45–55%) | 50% (45–55%) | 6% |
| Moderately Aggressive | Moderate–High | 70% (65–75%) | 30% (25–35%) | 7% |
| Aggressive | High | 80% (75–85%) | 20% (15–25%) | 7% |

**Rebasing for gold.** Equity and debt bands are defined as shares of the non-gold portfolio. The solver applies them scaled by `(100 - gold) / 100`, rounded to 1 dp. Example: Aggressive equity 75–85% becomes 69.8–79.0% with 7% gold. Equity + debt + gold plus a small cash/other residual (from fund holdings) make up 100%. The rebased bands are what the screen shows as targets.

---

## 2. Fund Universe

### Source
Daily Excel file from Morningstar, parsed into `DailyFundData` table. Only **R1 and R2 ranked funds** with a valid NAV are eligible.

### Asset Classes Used
- **Equity** — Active equity funds only (no ETFs, no passive index funds)
- **Debt** — Active debt funds
- **Hybrid** — Allocation and savings hybrid funds

### Core Equity Categories (`CORE_EQUITY_CATS`)
These are the only equity categories eligible for any model portfolio:
```
India Fund Large-Cap
India Fund Large & Mid-Cap
Cat: Flexi Cap Funds
Cat: Multi Cap Funds
India Fund Focused Fund
India Fund Mid-Cap
India Fund Small-Cap
Cat: Contra / Value Funds
```
Thematic, sectoral, ELSS, ETF, index, and solution-oriented funds are excluded.

---

## 3. Risk Tier System

### Debt Risk Tiers (`DEBT_RISK_TIER`)
| Tier | Categories | Character |
|---|---|---|
| 1 | Overnight, Liquid, Money Market, Ultra Short Duration | Zero duration, zero credit risk |
| 2 | Low Duration, Floating Rate, Banking & PSU, Short Duration, Corporate Bond, Government Bond | Short duration, high quality (AAA/Govt) |
| 3 | Medium Duration, Medium to Long Duration, Dynamic Bond | Medium duration, high quality |
| 4 | Long Duration, 10yr Govt Bond, Credit Risk | Higher risk — long duration or credit |

### Hybrid Risk Tiers (`HYBRID_RISK_TIER`)
| Tier | Categories | Equity Content | Debt Content |
|---|---|---|---|
| 1 | Arbitrage Fund, Conservative Allocation | ~0–25% | ~65–100% |
| 2 | Equity Savings - Conservative, Equity Savings (plain) | ~25–40% | ~12–20% |
| 3 | Dynamic Asset Allocation, Balanced Allocation, Multi Asset Allocation, Equity Savings - Aggressive | ~55–88% | ~8–25% |
| 4 | Aggressive Allocation | ~75–85% | ~10–15% |

**Key principle:** Higher tier = higher equity content, higher risk. Models include hybrid tiers up to their appropriate risk level.

---

## 4. Candidate Pool Construction (`_pick_candidates`)

Before the solver runs, a candidate pool is assembled per model. This is a three-sleeve process:

### 4.1 Equity Sleeve
- Filter to `allowed_equity_cats` (model-specific, subset of `CORE_EQUITY_CATS`)
- Pick the **N best-fit funds per category**, where N = `eq_per_cat` (or `eq_cat_limits[cat]` if overridden)
- "Best fit" = minimum deviation from the model's cap mix target (L/M/S)
- Categories iterated in `CORE_EQUITY_CATS` order

### 4.2 Debt Sleeve
- Filter by `allowed_debt_cats` (if defined) or `debt_tiers` (tier-based filter)
- For Aggressive/Mod-Aggressive (`max_debt_funds=1`): must be from `AGG_DEBT_CATS` — Corporate Bond, Dynamic Bond, Ultra Short Duration, or Government Bond
- Pick best Sharpe ratio fund per category, in `DEBT_PRIORITY` order, up to `max_debt_funds`

**`DEBT_PRIORITY` order (highest to lowest priority):**
```
Corporate Bond → Ultra Short Duration → Money Market → Government Bond →
Floating Rate → Banking & PSU → Short Duration → Low Duration →
Dynamic Bond → Medium Duration → Medium to Long Duration → Liquid → Overnight → Credit Risk
```

### 4.3 Hybrid Sleeve
- Filter by `hybrid_tiers` (tier-based), then apply `hyb_cat_limits` overrides
- `hyb_cat_limits` value = 0 means that category is **excluded entirely**
- Pick best cap-fit funds per category in `HYBRID_PRIORITY` order, up to `hyb_per_cat` (or `hyb_cat_limits[cat]`)

**`HYBRID_PRIORITY` order:**
```
Dynamic Asset Allocation → Balanced Allocation → Multi Asset Allocation →
Equity Savings - Aggressive → Equity Savings (plain) → Equity Savings - Conservative →
Aggressive Allocation → Conservative Allocation → Arbitrage Fund
```

### 4.4 Deduplication
After assembling all three sleeves, duplicates (same ISIN or same fund name) are removed. First occurrence wins.

---

## 5. Global Solver Constants

```python
SOLVER_MODE = "lp"       # "lp" active; "bl_cvar" (Black-Litterman + CVaR) kept in code but switched off
MIN_FUNDS = 9            # Default minimum funds per portfolio
MAX_FUNDS = 15           # Hard cap — never more than 15 funds
MIN_W_LOOSE = 3.0        # Weights below 3% are not allowed (loose filter, always applied)
MIN_W_TIGHT = 5.0        # Weights below 5% are not allowed (tight filter, applied if ≤11 funds)
FUND_COUNT_THRESHOLD = 11 # Threshold at which tight filter is applied
CAP_TOL = 5.0            # Default cap mix tolerance ±5%
MAX_W = 15.0             # Max weight per fund (all models except Conservative / Mod Conservative)
PER_FUND_CAP = 15.0      # Same cap, used by the whole-% rounding check
FUND_HOUSE_CAP = 30.0    # Max combined weight per AMC (branding_name)
BAND_MARGIN = 3.0        # Solver aims this far inside the equity/debt floors (see section 7)
NAV_RISK_YEARS = 3       # Lookback for NAV-based risk and minimum fund history
```

**Per-model overrides possible:**
- `min_funds` — overrides `MIN_FUNDS` for that model (e.g. Conservative and Mod Conservative use 7)
- `max_w` — overrides `MAX_W`; **Conservative and Mod Conservative use 16.67%** (their debt-heavy pools are too thin to meet the bands at 15%); **Aggressive uses 12%** (at 15% its pool settles on 8 funds)
- `risk_lambda` — risk penalty in the solver objective (section 6.1)
- `cap_tol` — overrides `CAP_TOL` (e.g. Balanced uses 15 due to mixed hybrid pool)

---

## 6. The Solver — How It Works

### 6.1 What is HiGHS?
`scipy.optimize.linprog` with `method="highs"` — a high-performance Linear Programming solver. It finds weights satisfying all constraints simultaneously.

**Objective.** Among all weight sets that satisfy the constraints, the solver minimises
```
-Σ wᵢ · (return_3yᵢ - risk_lambda · sd_navᵢ)
```
i.e. it maximises weighted 3Y return minus a penalty on weighted SD. Both terms are linear, so the problem stays an LP. `sd_navᵢ` is the fund's own annualised SD from daily NAVs (section 9.3); if missing, the Morningstar SD, then the pool average.

| Model | `risk_lambda` |
|---|---|
| Conservative | 2.0 |
| Mod Conservative | 1.5 |
| Balanced | 1.0 |
| Mod Aggressive | 0.5 |
| Aggressive | 0.0 (pure return) |

A higher value pushes the model towards lower-risk funds, which is what separates the five models on return and SD.

### 6.2 Weight Variables
`w₁, w₂, ... wₙ` — portfolio weight for each of the N candidate funds (in %).

### 6.3 Constraints
All constraints are linear in the weights:

**Budget constraint:**
```
Σ wᵢ = 100
```

**Per-fund weight bounds:**
```
0 ≤ wᵢ ≤ max_w   (15%; 16.67% for Conservative and Mod Conservative; 12% for Aggressive)
```

**Fixed gold:**
```
Σ w_gold = gold_fixed   (5 / 5 / 6 / 7 / 7%)
```

**AMC cap:** funds sharing a `branding_name` together hold at most 30%.

**Effective equity (weighted average, accounts for hybrid equity content; rebased bands):**
```
Σ wᵢ · equity_pctᵢ / 100  ≥  eq_lo
Σ wᵢ · equity_pctᵢ / 100  ≤  eq_hi
```

**Effective debt (weighted average, accounts for hybrid debt content):**
```
Σ wᵢ · debt_pctᵢ / 100  ≥  debt_lo
Σ wᵢ · debt_pctᵢ / 100  ≤  debt_hi
```

**Cap mix — Large/Mid/Small (linearised ratio constraint):**

The true cap mix is a ratio: `Σ(wᵢ · eq_pctᵢ · largeᵢ) / Σ(wᵢ · eq_pctᵢ)`. Since ratios are non-linear, it is linearised by multiplying both sides by the denominator:

```
Σ wᵢ · (eq_pctᵢ/100) · (largeᵢ - (cap_large - cap_tol))  ≥  0
Σ wᵢ · (eq_pctᵢ/100) · (largeᵢ - (cap_large + cap_tol))  ≤  0
```
(Same form for mid and small)

**Important:** Only funds where `large + mid + small > 1` participate in cap mix constraints. Funds with missing or all-zero cap data are excluded — consistent with how cap mix is calculated in the output.

### 6.5 Gold sleeve and eligibility
- Gold/silver candidates come from `Precious Metals` funds; the picker (`_pick_gold_candidates`) offers the best-ranked gold funds.
- The gold weight is fixed per model and is **exempt from every weight filter** (3% / 5% minimums, rescaling), so the fixed allocation always survives.
- **Eligibility filter** (non-gold funds): a fund must have `return_3y` and at least one calendar-year return for 2021–2025. Gold is exempt from this filter.
- **Minimum NAV history:** every candidate, gold included, needs NAV data reaching back 3 years (7-day grace). This removes newer gold/silver fund-of-funds, so it mainly shapes the gold pool.

### 6.4 Equity/Debt Content per Fund
The solver uses these values per fund:

| Fund type | equity_pct used | debt_pct used |
|---|---|---|
| Pure equity fund | `equity_pct` from DB (typically ~95–99%) | 0% |
| Pure debt fund | 0% | 100% |
| Arbitrage fund | 0% | 100% (treated as debt) |
| Hybrid fund | `equity_pct` from DB | `bond_pct` from DB (if > 0), else 0% |

If `equity_pct` is null for an equity fund, 100% is assumed. If `bond_pct` is null for a hybrid, 0% is assumed.

---

## 7. Two-Pass Solver (`_solve_with_retry`)

The solver runs in two passes to balance fund count vs constraint satisfaction:

### Pass 1 — Forced fund count, with cap mix
```
forced_max_w = min(max_w, 100 / min_funds)
```
- For `min_funds=9`: `forced_max_w = 11.11%`
- For `min_funds=7`: `forced_max_w = 14.29%`

Capping each fund at `100/min_funds` forces the solver to spread weight across at least `min_funds` funds. The equity/debt bands, fixed gold, AMC cap **and the large/mid/small cap mix** (at the model's `cap_tol`) are all enforced from the first pass.

- **Safety margin:** the solver first aims `BAND_MARGIN` (3 points) above the equity and debt floors, because clean-up and rounding give a little back. If that is infeasible it retries on the exact band.
- **Minimum weights:** after each solve, any non-gold fund below the minimum weight (3%, or 5% when 11 or fewer funds are active) is barred and the LP is solved again, so the clean-up has nothing left to drop and the bands still hold.
- If the result has at least `min_funds` funds → **use it** (tagged `tol=999`).

### Pass 2 — Relaxed cap mix tolerance
If Pass 1 fails (infeasible, or fewer than `min_funds` funds):
- Use `max_w` per fund (15%, or 16.67% for the two Conservative models) — fund count is no longer guaranteed
- Retry with progressively relaxed cap mix tolerance: `base_tol → +3 → +6 → +10 → +15`, trying margin 3.0, 1.5 then 0 at each level
- `base_tol` defaults to `CAP_TOL=5`, or the model's own `cap_tol`

If all levels fail → last resort: widen equity/debt bands by ±5 and use `base_tol+20`.

### Why Two Passes?
Fund count and cap mix conflict for some models. Conservative / Mod Conservative have debt floors that need specific fund types and a small candidate pool, so they usually solve in Pass 2 (tags `lp_tol20.0` / `lp_tol8.0`). Balanced, Mod Aggressive and Aggressive solve in Pass 1 (`lp_tol999`).

---

## 8. Post-Solver Weight Filtering and Rounding

After the solver returns weights (`_filter_weights`, non-gold funds only; gold is exempt):

1. **Loose filter** — `wᵢ < 3%` → set to 0
2. **Renormalise** — non-gold weights scaled to fill `100 - gold`
3. **Tight filter** — only if fund count ≤ `FUND_COUNT_THRESHOLD (11)`: `wᵢ < 5%` → set to 0, renormalise again
4. **MAX_FUNDS cap** — if fund count > 15, drop lowest-weight non-gold funds until 15 remain
5. **Cap re-check** — rescaling can push a fund over the per-fund cap; the excess is clipped and handed to other funds. If it cannot be placed (weights no longer sum to 100) the result is rejected and the solver moves to the next pass.

Then in `_build_portfolio`:

6. **Liquid / Overnight exclusivity** — a portfolio may hold Liquid **or** Overnight, never both. If both appear, the one with the smaller weight is dropped and the rest rescaled.
7. **Whole-% rounding** — largest-remainder rounding to whole percentages summing to 100. It falls back to 1 dp if a fund exceeds its per-fund cap (+0.5) or an AMC exceeds 30% (+0.5), so the largest weight can show up to 0.5 above the cap (e.g. 17% for a 16.67% cap).

---

## 9. Output Calculations

### 9.1 Effective Equity and Debt
```
eff_equity = Σ weightᵢ × equity_pctᵢ / 100
eff_debt   = Σ weightᵢ × debt_pctᵢ / 100
eff_other  = max(0, 100 - eff_equity - eff_debt)
```
These are true portfolio-level weighted averages accounting for hybrid content.

### 9.2 Cap Mix (Rebased)
```
cap_den   = Σ weightᵢ × equity_pctᵢ/100    [only for funds where L+M+S > 1]
rb_large  = Σ (weightᵢ × equity_pctᵢ/100 × largeᵢ) / cap_den
rb_mid    = Σ (weightᵢ × equity_pctᵢ/100 × midᵢ)   / cap_den
rb_small  = Σ (weightᵢ × equity_pctᵢ/100 × smallᵢ) / cap_den
```
**Rebased** means cap mix is expressed relative to the equity-bearing portion only, not total portfolio. Funds with no cap data (`L+M+S ≤ 1`) are excluded from both numerator and denominator — their equity weight drops out of the denominator so remaining funds are rebased to 100%.

A fund with `L=50, M=50, S=0` is **included** — zero small cap is genuine data, not missing.

Finally, rb_large + rb_mid + rb_small are normalised to sum to exactly 100%.

### 9.3 Portfolio Standard Deviation (3Y, NAV-based)
Std Dev (3Y) is **not** an average of fund SDs. It is calculated from daily NAV returns over the last 3 years:
```
Σ  = covariance matrix of daily NAV returns × 252   (annualised)
SD = sqrt( wᵀ Σ w ) × 100
```
- Debt funds are included (Morningstar supplies no SD for any debt fund), and diversification between funds is reflected.
- Funds need at least 500 daily returns (about 2 years) and 250 common days per pair; a fund short of that is left out and the remaining weights are rebased (coverage is reported in `blended_coverage.std_dev_3y`). In practice every candidate has 3 years (section 6.5).
- Pairwise covariance can be slightly non-positive-definite; negative eigenvalues are clipped to zero.
- The fund table shows the NAV-based SD for any fund that has no Morningstar SD.
- The response carries `std_dev_3y_method` (`nav_covariance_daily_3y`, or `weighted_average` if NAV data cannot be read).
- Daily NAV series are cached per day, so the five portfolios share one database fetch.

### 9.3b Blended Portfolio Metrics (`wavg`)
All other portfolio-level metrics (1Y/3Y/5Y return, 5Y Std Dev, Sharpe, Expense Ratio) are weighted averages rebased to available data:
```
wavg(metric) = Σ(weightᵢ × metricᵢ) / Σ(weightᵢ)
               [sum only over funds where metricᵢ is not null]
```
If a fund has no 5Y data (e.g. newer fund), it is excluded from the 5Y calculation and the remaining weights are rebased. This means blended 5Y CAGR reflects only funds with 5-year history.

### 9.4 Time to Double
```
time_to_double = 72 / blended_5Y_CAGR   (Rule of 72)
```
Uses the **actual blended 5Y CAGR** from the portfolio — not an assumed return.

---

## 10. Per-Model Definitions (Current State)

### Conservative
| Parameter | Value |
|---|---|
| Equity target | 20% ±5 (rebased for 5% gold: 14.2–23.8%) |
| Debt target | 80% ±5 (rebased: 71.2–80.8%) |
| Cap mix target | L=75% M=15% S=10% ±5% (ranges 70–80 / 10–20 / 5–15) |
| Fixed gold | 5% |
| Max weight per fund | **16.67%** |
| Min funds | **7** |
| Hybrid tiers | 1, 2 (Conservative Allocation + Equity Savings only) |
| Equity categories | Large-Cap, Large & Mid-Cap, Flexi Cap |
| eq_per_cat | 1 |
| hyb_per_cat | 2 |
| max_debt_funds | 3 |

**Hybrid category limits:**
- Conservative Allocation: 2 (primary debt anchor, ~65–70% debt)
- Equity Savings - Conservative: 2
- Equity Savings (plain): 1
- Arbitrage Fund: **0** (excluded — adds nothing above debt)
- Dynamic Asset Allocation: **0** (too high equity)
- Aggressive Allocation: **0** (too high equity)

**Design intent:** Capital preservation. Debt-dominant. No arbitrage. No aggressive hybrid. Large-cap biased equity.

---

### Moderately Conservative
| Parameter | Value |
|---|---|
| Equity target | 30% ±5 (rebased for 5% gold: 23.8–33.2%) |
| Debt target | 70% ±5 (rebased: 61.8–71.2%) |
| Cap mix target | L=70% M=20% S=10% ±5% (ranges 65–75 / 15–25 / 5–15) |
| Fixed gold | 5% |
| Max weight per fund | **16.67%** |
| Min funds | **7** |
| Hybrid tiers | 1, 2, 3 |
| Equity categories | Large & Mid-Cap, Flexi Cap, Multi Cap |
| eq_per_cat | 2 |
| hyb_per_cat | 2 |
| max_debt_funds | 3 |

**Hybrid category limits:**
- Dynamic Asset Allocation: 2 (higher equity hybrid, differentiates from Conservative)
- Equity Savings - Aggressive: 2
- Equity Savings (plain): 1
- Equity Savings - Conservative: 1
- Conservative Allocation: 1 (debt anchor, needed for feasibility)
- Arbitrage Fund: **0** (excluded)
- Aggressive Allocation: **0** (too high equity)

**Design intent:** Modest step up from Conservative. More equity via Large & Mid Cap and Flexi Cap (higher return potential than pure Large Cap). DAA hybrids carry meaningful equity. No arbitrage. Debt floor lower than Conservative (52% vs 62%) to give room for higher-equity hybrids.

**Note on bands:** the equity/debt bands are now the centre ±5 definition above, rebased for gold. The 16.67% per-fund cap is kept for this model because the 15% cap makes the debt floor unreachable with this pool.

---

### Balanced
| Parameter | Value |
|---|---|
| Equity target | 50% ±5 (rebased for 6% gold: 42.3–51.7%) |
| Debt target | 50% ±5 (rebased: 42.3–51.7%) |
| Cap mix target | L=60% M=25% S=15% **±15%** (ranges 45–75 / 10–40 / 0–30) |
| Fixed gold | 6% |
| Max weight per fund | 15% |
| Min funds | 9 (default) |
| Hybrid tiers | 1, 2, 3, 4 |
| Equity categories | Large-Cap, Large & Mid-Cap, Flexi Cap, Multi Cap, Focused, Mid-Cap |
| eq_per_cat | 1 |
| hyb_per_cat | 4 |
| max_debt_funds | 3 |

**Hybrid category limits:**
- Dynamic Asset Allocation: 2
- Balanced Allocation: 2
- Multi Asset Allocation: 1
- Aggressive Allocation: 2
- Equity Savings - Aggressive: 2
- Equity Savings (plain): 1
- Equity Savings - Conservative: 1
- Conservative Allocation: 1 (debt anchor — key to Pass 1 feasibility)
- Arbitrage Fund: **0** (excluded)

**Design intent:** True 50/50 mandate. Wide hybrid pool needed — DAA, Aggressive Allocation, and Conservative Allocation all participate. Conservative Allocation (1 fund) is critical: at 65–70% debt, it provides the debt anchor that makes the 42–48% debt floor reachable at forced_max_w=11.1%. Cap tolerance widened to ±15 because the mixed hybrid pool makes tight cap mix constraints infeasible alongside the equity/debt targets.

---

### Moderately Aggressive
| Parameter | Value |
|---|---|
| Equity target | 70% ±5 (rebased for 7% gold: 60.5–69.8%) |
| Debt target | 30% ±5 (rebased: 23.2–32.6%) |
| Cap mix target | L=50% M=27% S=23% ±5% (ranges 45–55 / 22–32 / 18–28) |
| Fixed gold | 7% |
| Max weight per fund | 15% |
| Min funds | 9 (default) |
| Hybrid tiers | 2, 3, 4 (no tier 1) |
| Equity categories | All `CORE_EQUITY_CATS` |
| eq_per_cat | 2 |
| hyb_per_cat | 2 |
| max_debt_funds | **2** |

**Equity category limits (`eq_cat_limits`):**
- Multi Cap: 1 (capped at 1 to avoid overlap with Flexi Cap)
- Focused Fund: 1
- Contra/Value: 1

**Hybrid category limits:**
- Dynamic Asset Allocation: 2
- Aggressive Allocation: 2
- Equity Savings - Aggressive: 1
- Equity Savings (plain/conservative): **0** (too low equity)
- Conservative Allocation: **0** (too low equity — ~25% equity, wrong for 70%+ mandate)
- Arbitrage Fund: **0** (excluded)

**Design intent:** Growth with a debt ballast. Broad equity across all cap segments. DAA and Aggressive Allocation hybrids carry meaningful equity. Two debt funds (not one) needed — with only DAA hybrids contributing 8–24% debt each, a single debt fund at 11.1% max is insufficient to reach 27% debt floor.

---

### Aggressive
| Parameter | Value |
|---|---|
| Equity target | 80% ±5 (rebased for 7% gold: 69.8–79.0%) |
| Debt target | 20% ±5 (rebased: 14.0–23.2%) |
| Cap mix target | L=35% M=33% S=32% ±5% (ranges 30–40 / 28–38 / 27–37) |
| Fixed gold | 7% |
| Max weight per fund | **12%** |
| Min funds | 9 (default) |
| Hybrid tiers | 2, 3, 4 (no tier 1) |
| Equity categories | All `CORE_EQUITY_CATS` |
| eq_per_cat | 2 |
| hyb_per_cat | 2 |
| max_debt_funds | 1 |

**Equity category limits:**
- Multi Cap: 1
- Focused Fund: 1

**Design intent:** Maximum growth. Near-equal large/mid/small cap target (35/33/32) ensures broad market exposure. Single debt fund acts as a minimal ballast. No conservative hybrids.

---

## 11. Frontend Display (`ModelPortfolios.jsx`)

### Summary Chips (per portfolio)
| Chip | Value | Source |
|---|---|---|
| Equity (wtd avg) | Actual effective equity % | `p.actual.equity_pct` |
| Debt (wtd avg) | Actual effective debt % | `p.actual.debt_pct` |
| Cash & Others | Residual (100 - equity - debt) | `p.actual.cash_other_pct` |
| 5Y CAGR (wtd avg) | Actual blended 5Y return | `p.blended.return_5y` |
| Time to double | `72 / blended_5Y_CAGR` | Rule of 72, actual return |

### Cap Mix Bar Chart
Shows rebased L/M/S with target marker. Bars represent actual portfolio cap mix within the equity-bearing portion.

### Portfolio Metrics Row
| Metric | Source |
|---|---|
| 1Y Return | `blended.return_1y` (wavg, rebased) |
| 3Y CAGR | `blended.return_3y` (wavg, rebased) |
| 5Y CAGR | `blended.return_5y` (wavg, rebased) |
| Std Dev (3Y) | `blended.std_dev_3y` (covariance of daily NAV returns, annualised; section 9.3) |
| Std Dev (5Y) | `blended.std_dev_5y` (wavg, rebased) |
| Sharpe (3Y) | `blended.sharpe_3y` (wavg, rebased) |
| Expense Ratio | `blended.expense_ratio` (wavg, rebased) |

All other metrics are rebased to funds that have data for that metric. The volatility label on each model card (e.g. Conservative "5–6%") is descriptive text from the Aug 2026 version and is measured on a different basis from the NAV-based SD.

### Fund Table Columns
Fund | Sleeve | Rank | Weight | 1Y | 3Y | Std Dev 3Y | Std Dev 5Y | Sharpe | ER | Cap mix

---

## 12. Debugging

### Check all 5 portfolios
```
GET https://buglerock-analytics-ew17.onrender.com/api/models/portfolios
```

### Debug endpoint (fund count + errors per model)
```
GET https://buglerock-analytics-ew17.onrender.com/api/models/debug
```

### Local debug scripts
```bash
cd buglerock-analytics/backend
python debug_balanced3.py       # balanced solver trace
python debug_modagg.py          # mod_aggressive solver trace
python debug_modcons.py         # mod_conservative solver trace
python debug_cons_vs_modcons.py # compare conservative vs mod_conservative
python debug_wavg_coverage.py   # check data coverage for blended metrics
python debug_categories.py      # print all distinct category strings in DB
```

---

## 13. Change Log

| Date | Change | Files | Reason |
|---|---|---|---|
| 2026-08-04 | Added `HYBRID_RISK_TIER` entries for `India Fund Equity Savings`, `India Fund Balanced Allocation`, `India Fund Multi Asset Allocation` | `models.py` | These categories exist in DB but were missing from tier map — funds were silently excluded |
| 2026-08-04 | Added `DEBT_RISK_TIER` entries for `India OE Long Duration`, `India OE 10 yr Government Bond` | `models.py` | Missing DB categories |
| 2026-08-04 | Added `HYBRID_PRIORITY` entries for new hybrid categories | `models.py` | Required for new tiers to be picked in candidate selection |
| 2026-08-04 | Balanced: added `India Fund Conservative Allocation` (limit 1) via `hybrid_tiers=[1,2,3,4]` + `hyb_cat_limits` | `models.py` | Pass 1 was infeasible — Conservative Allocation's 65–70% debt content is the anchor that makes the 42–48% debt floor reachable at forced_max_w=11.1% |
| 2026-08-04 | Balanced: `cap_tol` set to 15 | `models.py` | Mixed hybrid pool makes ±5% cap mix infeasible alongside equity/debt targets |
| 2026-08-04 | Mod Aggressive: `hybrid_tiers [1,2,3,4] → [2,3,4]`, `hyb_per_cat 4→2`, added `hyb_cat_limits` blocking arbitrage/conservative/equity savings | `models.py` | 34-fund pool had 4 arbitrage funds (100% debt) distorting debt target; pool cleaned to DAA + Aggressive Allocation only |
| 2026-08-04 | Mod Aggressive: `max_debt_funds 1→2` | `models.py` | Single debt fund insufficient — DAA hybrids carry only 8–24% debt; need 2 pure debt funds to reach 27% floor |
| 2026-08-04 | Conservative: added `hyb_cat_limits` blocking arbitrage, DAA, Aggressive Allocation | `models.py` | Arbitrage adds no meaningful return above debt; DAA/Aggressive too high equity for conservative mandate |
| 2026-08-04 | Conservative: `debt_lo 67→62`, `min_funds: 7` | `models.py` | 67% floor infeasible at forced_max_w=14.3% (100/7); 62% achievable |
| 2026-08-04 | Mod Conservative: `eq_lo/hi 32–38→33–42`, `debt_lo/hi 62–68→52–62`, `hybrid_tiers [1,2,3]`, `eq_per_cat 1→2`, `max_debt_funds 2→3`, `min_funds: 7`, full `hyb_cat_limits` | `models.py` | Original bands infeasible — DAA hybrids carry insufficient debt; relaxed bands allow DAA hybrids while maintaining debt-dominant character |
| 2026-08-04 | `_solve_with_retry`: added per-model `min_funds` and `max_funds` override via `m.get()` | `models.py` | Conservative/Mod Conservative need 7 min funds, not global default of 9 |
| 2026-08-04 | `std_dev_5y` added to SQL query, blended metrics, and per-fund fields | `models.py` | Frontend requested 5Y std dev in table and portfolio metrics |
| 2026-08-04 | Summary chip: replaced hardcoded "Est. return p.a." with actual 5Y CAGR | `ModelPortfolios.jsx` | Assumption-based return (15% eq / 7% debt) replaced with real blended data |
| 2026-08-04 | Time to double: `72 / assumed_return → 72 / blended_5Y_CAGR` | `ModelPortfolios.jsx` | Consistent with 5Y CAGR chip; no more hardcoded assumptions |
| 2026-08-04 | Portfolio metrics row: added Std Dev (3Y) and Std Dev (5Y) | `ModelPortfolios.jsx` | Requested by user |
| 2026-08-04 | Fund table: added Std Dev 3Y and Std Dev 5Y columns | `ModelPortfolios.jsx` | Requested by user |
| 2026-08-13 | No model portfolio logic changes this session — all changes were in other components | — | See SESSION_SUMMARY_AUG13.md for full session changes |
| 2026-10-27 | Reverted to the LP solver as the main path (`SOLVER_MODE="lp"`); BL+CVaR kept in code but off. Max funds 15 | `models.py` | Requested: initial linear solver with constraints |
| 2026-10-27 | Equity/debt bands redefined as 20/80, 30/70, 50/50, 70/30, 80/20 each ±5, rebased by `(100 - gold)/100`; gold fixed 5/5/6/7/8% exempt from weight filters | `models.py` | Rulebook bands and fixed gold could not both fit (e.g. Aggressive floors 80+17 = 97 vs 92 available) |
| 2026-10-27 | Cap mix constraint applied from Pass 1; safety margin on equity/debt floors; iterative removal of sub-minimum weights | `models.py` | Mod Aggressive / Aggressive were outside their L/M/S ranges; clean-up and rounding pulled results below floors |
| 2026-10-27 | Max weight per fund 15% for all models; 16.67% (`max_w`) for Conservative and Mod Conservative | `models.py` | Conservative pools too thin to meet debt bands at 15% |
| 2026-10-27 | Solver objective: maximise 3Y return minus `risk_lambda` × SD (2.0 / 1.5 / 1.0 / 0.5 / 0.0) | `models.py` | Return and SD barely differed between models |
| 2026-10-27 | Portfolio SD now from covariance of daily NAV returns (3Y, annualised ×252); NAV-based SD shown for funds with no Morningstar SD; daily NAV cache | `models.py` | Morningstar SD is empty for every debt fund, so the old weighted average ignored the debt sleeve |
| 2026-10-27 | Minimum 3 years of NAV history for every candidate (gold included) | `models.py` | NAV-based risk needs a full lookback; excludes newer gold/silver FoFs |
| 2026-10-27 | Documented Sep 2026 rules already in code: AMC cap 30%, Liquid/Overnight exclusivity, eligibility filter, whole-% rounding | `models.py` | Rulebook had not been updated since Aug 2026 (the Sep 2026 architecture document is not in the repo) |
| 2026-10-30 | Aggressive fixed gold 8% → 7% | `models.py` | Requested |
| 2026-10-30 | Aggressive `max_w` 15% → 12% | `models.py` | On 29 Oct data the 15% cap left only 8 funds (four at the cap); 12% gives 9 funds with all bands and cap mix met |
