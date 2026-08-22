"""
Arithmetic vs Log-Normal Monte Carlo comparison
Uses exact default inputs from RetirementPlanner.jsx

Run from anywhere:
  python debug_lognormal.py
"""
import math, random, statistics

# ── Exact defaults from RetirementPlanner.jsx ─────────────────────────────────
AGE       = 35
RET_AGE   = 60
LIFE_EXP  = 90
CORPUS    = 5_000_000 / 100_000   # absolute ₹ → Lakhs = 50L
SIP_M     = 50_000
STEP_UP   = 8 / 100
SIP_TILL  = 60
EPF       = 1_500_000 / 100_000   # 15L
EPF_M     = 12_000
EPF_R     = 8.1 / 100
NPS       = 800_000 / 100_000     # 8L
NPS_M     = 10_000
NPS_R     = 10 / 100
ANN_RATE  = 6 / 100
EXPENSES  = 100_000               # monthly ₹
REPLACE   = 80 / 100
HEALTH_M  = 10_000                # monthly ₹
HEALTH_INF= 10 / 100
OTHER_INC = 0
TAX       = 10 / 100
INFLATION = 6 / 100
PRE_MU    = 12 / 100
PRE_SIG   = 14 / 100
POST_MU   = 8 / 100
POST_SIG  = 7 / 100
NSIM      = 5_000

# Goals (absolute ₹ → Lakhs)
GOALS = [
    {"name": "Child's Education", "age": 48, "amt": 4_000_000 / 100_000},
    {"name": "Child's Marriage",  "age": 55, "amt": 2_500_000 / 100_000},
]
LUMPS = []  # Property sale amt=0

# ── Return samplers ────────────────────────────────────────────────────────────
def norm_arith(mu, sigma):
    """Arithmetic normal — current model"""
    return random.gauss(mu, sigma)

def norm_lognormal(mu_arith, sigma_arith):
    """
    Log-normal — proposed model.
    Converts arithmetic (mu, sigma) to log-space params so that
    E[1+R] = 1+mu_arith and Std[1+R] = sigma_arith (approximately).
    """
    m = 1 + mu_arith
    s = sigma_arith
    sigma_ln = math.sqrt(math.log(1 + (s/m)**2))
    mu_ln    = math.log(m) - sigma_ln**2 / 2
    return math.exp(random.gauss(mu_ln, sigma_ln)) - 1

# ── Simulation engine ──────────────────────────────────────────────────────────
def simulate(use_lognormal=False, nsim=NSIM, seed=42):
    random.seed(seed)
    draw = norm_lognormal if use_lognormal else norm_arith

    years      = LIFE_EXP - AGE
    years_ret  = RET_AGE - AGE

    # Goals inflated to target year (in Lakhs)
    goals_by_yr = {}
    for g in GOALS:
        if g["age"] <= AGE or g["age"] > LIFE_EXP: continue
        yr = g["age"] - AGE
        goals_by_yr[yr] = goals_by_yr.get(yr, 0) + g["amt"] * (1 + INFLATION)**yr

    # EPF / NPS deterministic accumulation
    epf_c, nps_c = EPF, NPS
    epf_ann = (EPF_M * 12) / 100_000
    nps_ann = (NPS_M * 12) / 100_000
    for _ in range(years_ret):
        epf_c = epf_c * (1 + EPF_R) + epf_ann
        nps_c = nps_c * (1 + NPS_R) + nps_ann
    epf_at_ret       = epf_c
    nps_lump         = nps_c * 0.6
    nps_annuity_inc  = nps_c * 0.4 * ANN_RATE   # ₹L/yr fixed

    ann_exp    = (EXPENSES * 12 * REPLACE) / 100_000
    health_exp = (HEALTH_M * 12) / 100_000
    other_inc  = (OTHER_INC * 12) / 100_000

    all_paths  = []
    depletions = []

    for _ in range(nsim):
        c = CORPUS
        path = [c]
        dep_age = None
        sip = (SIP_M * 12) / 100_000

        for y in range(1, years + 1):
            cur_age = AGE + y
            is_ret  = cur_age > RET_AGE

            r = draw(POST_MU, POST_SIG) if is_ret else draw(PRE_MU, PRE_SIG)
            c = c * (1 + r)

            if cur_age <= SIP_TILL and cur_age <= RET_AGE:
                c  += sip
                sip *= (1 + STEP_UP)

            if cur_age == RET_AGE:
                c += epf_at_ret + nps_lump

            if y in goals_by_yr:
                c -= goals_by_yr[y]

            if is_ret:
                base_need   = ann_exp    * (1 + INFLATION)**y
                health_need = health_exp * (1 + HEALTH_INF)**y
                other       = other_inc  * (1 + INFLATION)**y
                net_need    = max(0, base_need + health_need - other - nps_annuity_inc)
                c -= net_need / (1 - TAX)

            if c <= 0 and dep_age is None:
                dep_age = cur_age
                c = 0

            path.append(c)

        all_paths.append(path)
        depletions.append(dep_age)

    def pct(values, p):
        s = sorted(values)
        idx = (len(s) - 1) * p
        lo, hi = int(idx), math.ceil(idx)
        return s[lo] + (s[hi] - s[lo]) * (idx - lo)

    ret_idx = RET_AGE - AGE
    at_ret_vals = [p[ret_idx] for p in all_paths]
    at_end_vals = [p[years]   for p in all_paths]

    success = sum(1 for d in depletions if d is None)

    return {
        "at_ret": {
            "P10": pct(at_ret_vals, 0.10),
            "P50": pct(at_ret_vals, 0.50),
            "P90": pct(at_ret_vals, 0.90),
        },
        "at_end": {
            "P10": pct(at_end_vals, 0.10),
            "P50": pct(at_end_vals, 0.50),
            "P90": pct(at_end_vals, 0.90),
        },
        "success_rate": round(success / nsim * 100, 1),
    }

# ── Formatting ────────────────────────────────────────────────────────────────
def fmt(lakh):
    if lakh >= 100: return f"₹{lakh/100:.2f} Cr"
    return f"₹{lakh:.1f} L"

def diff(a, b):
    if a == 0: return "N/A"
    p = (b - a) / abs(a) * 100
    sign = "+" if p >= 0 else ""
    return f"{sign}{p:.1f}%"

# ── Run both ──────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("  ARITHMETIC vs LOG-NORMAL MONTE CARLO — Default Inputs")
print("="*70)
print(f"  Age {AGE} → Retire {RET_AGE} → Life {LIFE_EXP} | {NSIM:,} simulations | seed=42")
print(f"  Corpus: {fmt(CORPUS)} | SIP: ₹{SIP_M:,}/mo | Step-up: {STEP_UP*100:.0f}%/yr")
print(f"  Pre-ret: {PRE_MU*100:.0f}% ± {PRE_SIG*100:.0f}%  |  Post-ret: {POST_MU*100:.0f}% ± {POST_SIG*100:.0f}%")
print(f"  EPF: {fmt(EPF)} | NPS: {fmt(NPS)} | Expenses: ₹{EXPENSES:,}/mo")
print(f"  Goals: {', '.join(g['name']+' '+fmt(g['amt']) for g in GOALS)}")
print()

print("Running Arithmetic Normal...  ", end="", flush=True)
arith = simulate(use_lognormal=False)
print("done")

print("Running Log-Normal...         ", end="", flush=True)
logn  = simulate(use_lognormal=True)
print("done")

# ── Results ───────────────────────────────────────────────────────────────────
print()
print(f"{'─'*70}")
print(f"  CORPUS AT RETIREMENT (Age {RET_AGE})")
print(f"{'─'*70}")
print(f"  {'Metric':<20} {'Arithmetic':>15} {'Log-Normal':>15} {'Difference':>12}")
print(f"  {'-'*20} {'-'*15} {'-'*15} {'-'*12}")
for k in ["P10", "P50", "P90"]:
    a, b = arith["at_ret"][k], logn["at_ret"][k]
    print(f"  {k+' ('+['worst 10%','median','best 10%'][[0,1,2][['P10','P50','P90'].index(k)]]+')':20} {fmt(a):>15} {fmt(b):>15} {diff(a,b):>12}")

print()
print(f"{'─'*70}")
print(f"  CORPUS AT END OF LIFE (Age {LIFE_EXP})")
print(f"{'─'*70}")
print(f"  {'Metric':<20} {'Arithmetic':>15} {'Log-Normal':>15} {'Difference':>12}")
print(f"  {'-'*20} {'-'*15} {'-'*15} {'-'*12}")
for k in ["P10", "P50", "P90"]:
    a, b = arith["at_end"][k], logn["at_end"][k]
    print(f"  {k+' ('+['worst 10%','median','best 10%'][[0,1,2][['P10','P50','P90'].index(k)]]+')':20} {fmt(a):>15} {fmt(b):>15} {diff(a,b):>12}")

print()
print(f"{'─'*70}")
print(f"  SUCCESS RATE (corpus survives to age {LIFE_EXP})")
print(f"{'─'*70}")
print(f"  Arithmetic Normal : {arith['success_rate']}%")
print(f"  Log-Normal        : {logn['success_rate']}%")
print(f"  Difference        : {diff(arith['success_rate'], logn['success_rate'])}")
print()
print("="*70)
print("  KEY DIFFERENCE:")
print("  Log-Normal bounds losses at -100% (no negative corpus from returns)")
print("  and produces a more realistic right-skewed distribution.")
print("  Higher P90 = more upside captured; lower P10 = tighter downside.")
print("="*70 + "\n")