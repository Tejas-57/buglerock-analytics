# BugleRock Model Portfolios — Simplified Rulebook

> **Version:** 2026-11-03 · **Covers:** the five risk-tiered model portfolios in FündIQ
> **Source of truth:** `backend/routers/models.py`. The full engineering rulebook is `MODEL_PORTFOLIOS_RULEBOOK.md`; this page keeps the rules and drops the solver maths.

---

## 1. The five models at a glance

Equity and debt targets are a centre value ±5 points, defined on the **non-gold** part of the portfolio. They are then **rebased** by `(100 − gold) / 100`, so equity + debt + gold can add up to 100. The rebased range is what the solver enforces and the screen shows.

| | Conservative | Mod. Conservative | Balanced | Mod. Aggressive | Aggressive |
|---|---|---|---|---|---|
| Risk score | 1 – Low | 2 – Low–Moderate | 3 – Moderate | 4 – Moderate–High | 5 – High |
| Indicative horizon | 3+ years | 3–5 years | 3–5 years | 5–7 years | 5+ years |
| Equity target | 20% ±5 | 30% ±5 | 50% ±5 | 70% ±5 | 80% ±5 |
| **Equity range used** | **14.2–23.8%** | **23.8–33.2%** | **42.3–51.7%** | **60.5–69.8%** | **69.8–79.0%** |
| Debt target | 80% ±5 | 70% ±5 | 50% ±5 | 30% ±5 | 20% ±5 |
| **Debt range used** | **71.2–80.8%** | **61.8–71.2%** | **42.3–51.7%** | **23.2–32.6%** | **14.0–23.2%** |
| Fixed gold | 5% | 5% | 6% | 7% | 7% |
| Cap mix target (L / M / S) | 75 / 15 / 10 | 70 / 20 / 10 | 60 / 25 / 15 | 50 / 27 / 23 | 35 / 33 / 32 |
| Cap mix tolerance | ±5 | ±5 | **±15** | ±5 | ±5 |
| Max weight per fund | 16.67% | 16.67% | 15% | 15% | **12%** |
| Minimum funds | 7 | 7 | 9 | 9 | 9 |
| Max debt funds in the pool | 3 | 3 | 3 | 2 | 1 |
| Risk penalty (`risk_lambda`) | 2.0 | 1.5 | 1.0 | 0.5 | 0.0 |

---

## 2. How a model is built

1. **Universe.** Start from funds ranked **R1 or R2** on the latest Morningstar daily file that have a NAV. Gold/silver funds are the exception: they are admitted whatever their rank.
2. **Eligibility.** A non-gold fund needs a 3-year return and at least one calendar-year return for 2021–2025. Every candidate, gold included, also needs **3 years of NAV history** (7-day grace).
3. **Candidate pool.** For each model, pick a short list of funds from three sleeves (equity, hybrid, debt) using that model's category limits (section 4). Within a category the equity and hybrid pick is the fund whose cap mix is **closest to the model's L/M/S target**. For debt it is the **best 3Y Sharpe** fund.
4. **Weights.** A **linear programming (LP) solver** (HiGHS) chooses the weights. It maximises weighted 3Y return minus `risk_lambda` × weighted 3Y standard deviation, subject to the constraints in section 3. A higher `risk_lambda` pushes the model to lower-risk funds; Aggressive uses 0, so it is pure return.
5. **Clean-up.** Drop tiny weights, enforce the Liquid/Overnight rule, then round to whole percentages that sum to 100.

The models are **rebuilt on each day's data**, so fund choices and weights move slightly from day to day.

---

## 3. Rules that apply to all five models

| Rule | Value |
|---|---|
| Weights sum to | 100% |
| Fixed gold | Exactly the model's gold % (section 1). Exempt from every minimum-weight filter. |
| Effective equity / debt | A weighted average that counts the equity and bond content *inside* hybrids, not just the fund label. Must fall in the model's rebased range. |
| Cap mix (Large / Mid / Small) | Measured on the equity part only, rebased to 100. Must sit within ±tolerance of the target. Funds with no cap data are left out of this calculation. |
| Per-fund cap | 15% by default; 16.67% for the two Conservative models; 12% for Aggressive. |
| AMC cap | Funds from the same fund house together hold at most **30%**. |
| Fund count | Minimum per model (7 or 9). Maximum **15** for all. |
| Minimum weight | A non-gold fund below **3%** is dropped; below **5%** if the portfolio has 11 or fewer funds. |
| Liquid / Overnight | A portfolio can hold a Liquid fund or an Overnight fund, **never both**. The smaller one is dropped. |
| Rounding | Whole percentages (largest-remainder method). If that would break a cap, it falls back to one decimal. |

### If the solver cannot find a portfolio
It tries in this order and reports which step it used:

1. **Pass 1:** force the minimum fund count (per-fund cap tightened to `100 / min_funds`), with the cap mix on.
2. **Pass 2:** loosen the cap-mix tolerance in steps (+3, +6, +10, +15 points).
3. **Last resort:** widen the equity and debt bands by 5 points each side.

Conservative and Mod. Conservative usually end up in Pass 2, because their debt-heavy pools are small. So their cap mix can sit outside the ±5 shown on screen. This is by design.

### Debt priority order
For each model the debt pool takes the best-Sharpe fund from each of the **first N categories** in this order, where N is "Max debt funds" in section 1:

`Corporate Bond → Ultra Short Duration → Money Market → Government Bond → Floating Rate → Banking & PSU → Short Duration → Low Duration → Dynamic Bond → Medium Duration → Medium to Long Duration → Liquid → Overnight → Credit Risk`

Long Duration and 10-yr Government Bond funds are in the risk tiers but not in this list, so they are never picked.

### Gold sleeve
Gold/silver funds are picked **largest AUM first**, at most two: one ETF and one fund of funds. There is **no silver cap** in the active solver.

---

## 4. Model by model

Category names drop the "India Fund" / "India OE" / "Cat:" prefixes. "Up to N" means at most N funds from that category enter the candidate pool.

### 4.1 Conservative — capital preservation

| | |
|---|---|
| **Mandate** | Low volatility, stable returns, debt-dominant with limited equity. |
| **Equity** | 14.2–23.8% (target 20 ±5) |
| **Debt** | 71.2–80.8% (target 80 ±5) |
| **Gold** | 5% fixed |
| **Cap mix** | L 75 / M 15 / S 10, ±5 |
| **Per-fund cap / min funds** | 16.67% / 7 |
| **`risk_lambda`** | 2.0 |

**Equity categories (1 fund each):** Large-Cap, Large & Mid-Cap, Flexi Cap.

**Debt categories (up to 3 funds in total):** Corporate Bond, Ultra Short Duration, Money Market, Government Bond, Floating Rate only.

**Hybrid categories:** Conservative Allocation (up to 2), Equity Savings – Conservative (up to 2), Equity Savings (up to 1).
**Excluded:** Arbitrage, Dynamic Asset Allocation, Aggressive Allocation and every other hybrid.

**Why:** arbitrage adds little over debt; dynamic and aggressive hybrids carry too much equity. Large-cap-biased equity.

---

### 4.2 Moderately Conservative — modest growth

| | |
|---|---|
| **Mandate** | A step up from Conservative: more equity through hybrids and broader equity categories, still debt-heavy. |
| **Equity** | 23.8–33.2% (target 30 ±5) |
| **Debt** | 61.8–71.2% (target 70 ±5) |
| **Gold** | 5% fixed |
| **Cap mix** | L 70 / M 20 / S 10, ±5 |
| **Per-fund cap / min funds** | 16.67% / 7 |
| **`risk_lambda`** | 1.5 |

**Equity categories (up to 2 each):** Large & Mid-Cap, Flexi Cap, Multi Cap.

**Debt categories (up to 3 funds in total):** any category in the priority list above.

**Hybrid categories:** Dynamic Asset Allocation (up to 2), Balanced Allocation (2), Multi Asset Allocation (2), Equity Savings – Aggressive (2), Equity Savings (1), Equity Savings – Conservative (1), Conservative Allocation (1).
**Excluded:** Arbitrage, Aggressive Allocation.

**Why:** the dynamic-allocation hybrids carry meaningful equity, so the debt band is lower than Conservative's. One Conservative Allocation fund is kept as a debt anchor, because the 16.67% per-fund cap is needed to reach the debt floor.

---

### 4.3 Balanced — 50/50 mandate

| | |
|---|---|
| **Mandate** | Moderate growth with reduced volatility; balances appreciation and income. |
| **Equity** | 42.3–51.7% (target 50 ±5) |
| **Debt** | 42.3–51.7% (target 50 ±5) |
| **Gold** | 6% fixed |
| **Cap mix** | L 60 / M 25 / S 15, **±15** |
| **Per-fund cap / min funds** | 15% / 9 |
| **`risk_lambda`** | 1.0 |

**Equity categories (1 fund each):** Large-Cap, Large & Mid-Cap, Flexi Cap, Multi Cap, Focused, Mid-Cap.

**Debt categories (up to 3 funds in total):** any category in the priority list.

**Hybrid categories:** Dynamic Asset Allocation (up to 2), Balanced Allocation (2), Aggressive Allocation (2), Equity Savings – Aggressive (2), Multi Asset Allocation (1), Equity Savings (1), Equity Savings – Conservative (1), Conservative Allocation (1).
**Excluded:** Arbitrage.

**Why:** a wide hybrid pool is needed to hit a true 50/50 split. The cap-mix tolerance is widened to ±15 because the mixed hybrid pool cannot meet a tight cap mix alongside the equity and debt targets. One Conservative Allocation fund is the debt anchor that makes the debt floor reachable.

---

### 4.4 Moderately Aggressive — growth with a debt ballast

| | |
|---|---|
| **Mandate** | Growth-tilted; broad equity across the cap range, aggressive hybrids, small debt allocation. |
| **Equity** | 60.5–69.8% (target 70 ±5) |
| **Debt** | 23.2–32.6% (target 30 ±5) |
| **Gold** | 7% fixed |
| **Cap mix** | L 50 / M 27 / S 23, ±5 |
| **Per-fund cap / min funds** | 15% / 9 |
| **`risk_lambda`** | 0.5 |

**Equity categories:** all eight core categories. Up to 2 each for Large-Cap, Large & Mid-Cap, Flexi Cap, Mid-Cap and Small-Cap. Up to 1 each for Multi Cap, Focused and Contra/Value.

**Debt categories (up to 2 funds in total):** any category in the priority list.

**Hybrid categories:** Dynamic Asset Allocation (up to 2), Balanced Allocation (2), Multi Asset Allocation (2), Aggressive Allocation (2), Equity Savings – Aggressive (1).
**Excluded:** Equity Savings, Equity Savings – Conservative, Conservative Allocation, Arbitrage.

**Why:** the low-equity hybrids are blocked because they dilute a 70% equity mandate. Two debt funds are needed, since the hybrids carry only 8–24% debt each and one debt fund at the per-fund cap cannot reach the debt floor.

---

### 4.5 Aggressive — maximum growth

| | |
|---|---|
| **Mandate** | Highest growth potential across all cap segments, for long horizons and high risk tolerance. |
| **Equity** | 69.8–79.0% (target 80 ±5) |
| **Debt** | 14.0–23.2% (target 20 ±5) |
| **Gold** | 7% fixed |
| **Cap mix** | L 35 / M 33 / S 32, ±5 |
| **Per-fund cap / min funds** | **12%** / 9 |
| **`risk_lambda`** | 0.0 (pure return) |

**Equity categories:** all eight core categories. Up to 2 each, except Multi Cap and Focused, which are up to 1.

**Debt categories (1 fund only):** Corporate Bond, Ultra Short Duration, Government Bond or Dynamic Bond. Corporate Bond goes first.

**Hybrid categories (up to 2 each):** Dynamic Asset Allocation, Balanced Allocation, Multi Asset Allocation, Aggressive Allocation, Equity Savings – Aggressive, Equity Savings, Equity Savings – Conservative.
**Excluded:** Arbitrage and Conservative Allocation (their risk tiers are not allowed for this model).

**Why:** near-equal large/mid/small targets give broad market exposure. The 12% per-fund cap spreads weight across at least 9 funds; at 15% the pool settled on only 8.

---

## 5. Glossary

| Term | Meaning |
|---|---|
| **R1 / R2** | The top two internal fund rankings. Only these funds are eligible (gold excepted). |
| **Rebased band** | A target range scaled by `(100 − gold) / 100` so equity, debt and gold fit together. |
| **Effective equity / debt** | Portfolio-level equity or debt exposure, counting the equity and bond content held inside hybrid funds. |
| **Cap mix (L/M/S)** | Split of the equity exposure across large, mid and small caps. |
| **Tolerance** | How far the actual cap mix may sit from the target. |
| **AMC** | Asset management company (fund house). |
| **Sleeve** | One bucket of the portfolio: equity, hybrid, debt or gold. |
| **LP solver** | Linear programming solver (HiGHS) that picks weights under the constraints. |
| **`risk_lambda`** | How strongly the solver penalises standard deviation. Higher means a lower-risk portfolio. |
| **SD (3Y)** | Annualised standard deviation of daily NAV returns over 3 years. The portfolio figure uses the covariance of the funds' daily returns, so it reflects diversification and includes debt funds. |
| **Sharpe (3Y)** | Return per unit of risk over 3 years. Used to choose among debt funds. |
| **Time to double** | `72 / blended 5Y CAGR` (Rule of 72), shown on screen. |

---

## 6. Known limits

- The return floor, down-capture ceiling, stress ceiling, mid+small look-through ceiling, AAA/AA credit floor and duration ceiling that appear in the code configuration are **not enforced** by the active solver. They belong to an optimiser that is switched off.
- Gold is picked by size, not rank, and silver is uncapped.
- The volatility and drawdown ranges printed on the model cards are descriptive text from an earlier version. They are not computed from the current portfolios.
- Some hybrid categories are allowed by default for models where the full rulebook does not list them (for example Balanced Allocation and Multi Asset Allocation in Mod. Conservative and Mod. Aggressive). This page lists what the code actually allows.
