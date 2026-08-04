# BugleRock Model Portfolios — Rulebook

> **Source files:** `backend/routers/models.py` · `frontend/src/components/ModelPortfolios/ModelPortfolios.jsx`  
> **Last updated:** 2026-08-04  
> Every future change to model portfolio logic must be reflected in this document alongside the code change.

---

## 1. Overview

BugleRock's model portfolios are five risk-tiered, constraint-based portfolios constructed daily from the R1/R2 ranked mutual fund universe. They are **not equal-weight** and **not manually curated** — a linear programming solver finds optimal weights that satisfy a set of financial constraints defined per model.

| Model | Risk | Equity Target | Debt Target |
|---|---|---|---|
| Conservative | Low | 22–28% | 62–73% |
| Moderately Conservative | Low–Moderate | 33–42% | 52–62% |
| Balanced | Moderate | 52–58% | 42–48% |
| Moderately Aggressive | Moderate–High | 68–76% | 27–33% |
| Aggressive | High | 80–87% | 17–23% |

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
MIN_FUNDS = 9            # Default minimum funds per portfolio
MAX_FUNDS = 15           # Hard cap — never more than 15 funds
MIN_W_LOOSE = 3.0        # Weights below 3% are zeroed (loose filter, always applied)
MIN_W_TIGHT = 5.0        # Weights below 5% are zeroed (tight filter, applied if ≤11 funds)
FUND_COUNT_THRESHOLD = 11 # Threshold at which tight filter is applied
CAP_TOL = 5.0            # Default cap mix tolerance ±5%
MAX_W = 20.0             # Absolute max weight per fund (hard cap)
```

**Per-model overrides possible:**
- `min_funds` — overrides `MIN_FUNDS` for that model (e.g. Conservative and Mod Conservative use 7)
- `max_funds` — overrides `MAX_FUNDS`
- `cap_tol` — overrides `CAP_TOL` (e.g. Balanced uses 15 due to mixed hybrid pool)

---

## 6. The Solver — How It Works

### 6.1 What is HiGHS?
`scipy.optimize.linprog` with `method="highs"` — a high-performance Linear Programming solver. It finds weights satisfying all constraints simultaneously. We use it as a **pure feasibility LP** — the objective function is zero (we don't optimise for anything, we just find a valid solution).

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
0 ≤ wᵢ ≤ max_w   (for all i)
```

**Effective equity (weighted average, accounts for hybrid equity content):**
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

### Pass 1 — Forced fund count, no cap mix
```
forced_max_w = min(MAX_W, 100 / min_funds)
```
- For `min_funds=9`: `forced_max_w = 11.11%`
- For `min_funds=7`: `forced_max_w = 14.29%`

By capping each fund at `100/min_funds`, the solver mathematically must spread weight across at least `min_funds` funds to sum to 100%. Cap mix constraints are **omitted** in Pass 1 — only equity and debt targets are enforced.

If Pass 1 produces ≥ `min_funds` funds → **use this result** (tagged as `tol=999`).

### Pass 2 — Full constraints, relaxed cap mix tolerance
If Pass 1 fails (infeasible or < `min_funds` funds after filtering):
- Use `MAX_W = 20%` per fund (more flexibility, but fund count no longer guaranteed)
- Include cap mix constraints
- Retry with progressively relaxed tolerance: `base_tol → +3 → +6 → +10 → +15`
- `base_tol` defaults to `CAP_TOL=5`, or model's own `cap_tol` if set

If all tolerance levels fail → last resort: widen equity/debt bands by ±5 and use `base_tol+20`.

### Why Two Passes?
Fund count and cap mix constraints conflict for some models. Conservative/Mod Conservative have tight debt floors (62%+) that require specific fund types — forcing cap mix on top of that at `forced_max_w` can be infeasible. The two-pass approach prioritises fund count (Pass 1) but falls back gracefully (Pass 2).

---

## 8. Post-Solver Weight Filtering

After the solver returns weights:

1. **Loose filter** — always applied: `wᵢ < 3%` → set to 0
2. **Renormalise** — remaining weights scaled to sum to 100%
3. **Tight filter** — applied only if fund count ≤ `FUND_COUNT_THRESHOLD (11)`: `wᵢ < 5%` → set to 0, renormalise again
4. **MAX_FUNDS cap** — if fund count > 15, drop lowest-weight funds until 15 remain

The tight filter prevents many small token positions (e.g. 3.2% in 12 funds), keeping portfolios clean and manageable.

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

### 9.3 Blended Portfolio Metrics (`wavg`)
All portfolio-level metrics (1Y/3Y/5Y return, Std Dev, Sharpe, Expense Ratio) are weighted averages rebased to available data:
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
| Equity target | 22–28% |
| Debt target | 62–73% |
| Cap mix target | L=75% M=15% S=10% ±5% |
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
| Equity target | 33–42% |
| Debt target | 52–62% |
| Cap mix target | L=70% M=20% S=10% ±5% |
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

**Note on bands:** Original debt_lo was 67% (same as Conservative) but this was infeasible with the DAA hybrid pool at forced_max_w=14.3%. Relaxed to 52% to allow the solver to use DAA hybrids without contradiction.

---

### Balanced
| Parameter | Value |
|---|---|
| Equity target | 52–58% |
| Debt target | 42–48% |
| Cap mix target | L=60% M=25% S=15% **±15%** |
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
| Equity target | 68–76% |
| Debt target | 27–33% |
| Cap mix target | L=50% M=27% S=23% ±5% |
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
| Equity target | 80–87% |
| Debt target | 17–23% |
| Cap mix target | L=35% M=33% S=32% ±5% |
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
| Std Dev (3Y) | `blended.std_dev_3y` (wavg, rebased) |
| Std Dev (5Y) | `blended.std_dev_5y` (wavg, rebased) |
| Sharpe (3Y) | `blended.sharpe_3y` (wavg, rebased) |
| Expense Ratio | `blended.expense_ratio` (wavg, rebased) |

All metrics rebased to funds that have data for that metric.

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