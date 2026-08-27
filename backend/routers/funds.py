# routers/funds.py
from fastapi import APIRouter, Query, UploadFile
from datetime import date as date_type, timedelta
from services.db_service import (
    get_asset_classes, get_categories, get_funds_for_dropdown,
    has_data_for_date, get_latest_data_date
)
from services.gmail_watcher import fetch_and_store, fetch_latest, get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD

router = APIRouter()


def resolve_date(date_str: str = None) -> date_type:
    # Always use latest data date — ignore user-supplied date if no data exists for it
    latest = get_latest_data_date()
    if date_str:
        d = date_type.fromisoformat(date_str)
        from services.db_service import has_data_for_date
        if has_data_for_date(d):
            return d
    return latest if latest else date_type.today()


def ensure_todays_data(d=None):
    fetch_latest(check_days=3)


@router.get("/asset-classes")
def asset_classes(date: str = Query(None)):
    d = resolve_date(date)
    ensure_todays_data(d)
    return {"asset_classes": get_asset_classes(d), "date": str(d)}


@router.get("/categories")
def categories(asset_class: str, date: str = Query(None)):
    d = resolve_date(date)
    return {"categories": get_categories(d, asset_class), "date": str(d)}


@router.get("/list")
def fund_list(asset_class: str, category: str, date: str = Query(None), all: bool = Query(False)):
    d = resolve_date(date)
    if all:
        from services.db_service import get_all_funds_for_dropdown
        funds = get_all_funds_for_dropdown(d, asset_class, category)
    else:
        funds = get_funds_for_dropdown(d, asset_class, category)
    return {"funds": funds, "date": str(d)}


@router.get("/merged-list")
def merged_fund_list(categories: str, asset_class: str, date: str = Query(None)):
    """Fetch funds from multiple categories and tag each with its sub-category label."""
    from services.db_service import get_all_funds_for_dropdown
    d = resolve_date(date)
    cat_list = categories.split("|")
    
    LABELS = {
        "India Fund Equity Savings - Aggressive": "Aggressive",
        "India Fund Equity Savings - Conservative": "Conservative",
    }
    
    all_funds = []
    for cat in cat_list:
        cat = cat.strip()
        funds = get_all_funds_for_dropdown(d, asset_class, cat)
        label = LABELS.get(cat, "")
        for f in funds:
            f["sub_label"] = label
        all_funds.extend(funds)
    
    return {"funds": all_funds, "date": str(d)}


@router.get("/peers")
def get_peer_funds(category: str, date: str = Query(None), rankings: str = "R1,R2", exclude: str = ""):
    """
    Return R1/R2 ranked funds in the same category — used for peer suggestions
    in the Compare Funds tab. Rankings and exclude ISINs are comma-separated.
    """
    from services.db_service import search_funds_by_category
    d = resolve_date(date)
    ranking_list = [r.strip() for r in rankings.split(",") if r.strip()]
    funds = search_funds_by_category(category, d, rankings=ranking_list)
    exclude_set = {e.strip() for e in exclude.split(",") if e.strip()}
    funds = [f for f in funds if f["isin"] not in exclude_set]
    return {"funds": funds, "category": category, "date": str(d)}


@router.get("/search")
def search_funds(q: str, date: str = Query(None)):
    """Global fund search across all categories."""
    if not q or len(q.strip()) < 2:
        return {"funds": []}
    from services.db_service import search_funds_global
    d = resolve_date(date)
    funds = search_funds_global(q.strip(), d)
    return {"funds": funds, "date": str(d)}


@router.get("/fetch")
def manual_fetch(date: str = Query(...)):
    """Manually trigger fetch for a specific date — for testing/recovery only."""
    # Use raw date directly — don't resolve, we want to fetch new data
    d = date_type.fromisoformat(date)
    success = fetch_and_store(d)
    return {
        "date": str(d),
        "success": success,
        "message": "Data loaded successfully" if success else "No email found for this date"
    }


@router.get("/debug-gmail")
def debug_gmail(date: str = Query(...)):
    """Debug Gmail search for a given date."""
    d = resolve_date(date)
    email_date = d + __import__('datetime').timedelta(days=1)

    try:
        service = get_gmail_service()
        after  = email_date.strftime("%Y/%m/%d")
        before = (email_date + __import__('datetime').timedelta(days=1)).strftime("%Y/%m/%d")
        query  = f"from:{GMAIL_SENDER} subject:{SUBJECT_KEYWORD} has:attachment after:{after} before:{before}"
        result = service.users().messages().list(userId="me", q=query).execute()
        messages = result.get("messages", [])

        broad = service.users().messages().list(
            userId="me", q=f"from:{GMAIL_SENDER} has:attachment", maxResults=5
        ).execute()
        recent = []
        for m in broad.get("messages", [])[:5]:
            msg = service.users().messages().get(
                userId="me", id=m["id"], format="metadata",
                metadataHeaders=["subject", "date"]
            ).execute()
            headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
            recent.append({"subject": headers.get("subject",""), "date": headers.get("date","")})

        return {
            "data_date": str(d),
            "email_date_searched": str(email_date),
            "query_used": query,
            "exact_match_count": len(messages),
            "recent_emails": recent,
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/upload")
async def upload_file(file: "UploadFile", date: str = Query(...)):
    """
    Directly upload an Excel file to load data — bypasses Gmail.
    e.g. POST /api/funds/upload?date=2026-05-12
    """
    import tempfile, os
    from services.parser import parse_excel_file
    from services.db_service import save_parsed_data
    from datetime import date as date_type

    d = date_type.fromisoformat(date)  # use exact date, no trading day resolution
    contents = await file.read()

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    try:
        tmp.write(contents)
        tmp_path = tmp.name
    finally:
        tmp.close()

    try:
        parsed = parse_excel_file(
            file_path=tmp_path,
            data_date=str(d),
            email_date=str(d),
            file_name=file.filename,
        )
        save_parsed_data(parsed)
        return {
            "success": True,
            "date": str(d),
            "funds": len(parsed["funds"]),
            "benchmarks": len(parsed["benchmarks"]),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

# ── Investment Intelligence ────────────────────────────────────────────────────
INTEL_EQUITY_CATS = [
    "India Fund Large-Cap",
    "India Fund Large & Mid-Cap",
    "Cat: Flexi Cap Funds",
    "Cat: Multi Cap Funds",
    "India Fund Focused Fund",
    "India Fund Mid-Cap",
    "India Fund Small-Cap",
    "Cat: Contra / Value Funds",
]
INTEL_HYBRID_CATS = [
    "India Fund Dynamic Asset Allocation",
    "India Fund Balanced Allocation",
    "India Fund Multi Asset Allocation",
    "India Fund Equity Savings - Aggressive",
    "India Fund Equity Savings",
    "India Fund Equity Savings - Conservative",
    "India Fund Aggressive Allocation",
    "India Fund Conservative Allocation",
]
INTEL_CATS   = INTEL_EQUITY_CATS + INTEL_HYBRID_CATS
MIN_CAT_SIZE = 5          # skip categories with fewer funds
IMPROVE_THRESHOLD = 0.35  # 35 percentile points = meaningful momentum shift


def _pct_of_val(val, sorted_vals):
    """
    Percentile of val within a pre-sorted list.
    Higher val → higher percentile (0.0–1.0).
    Uses linear interpolation so ties get the same score.
    """
    if not sorted_vals or len(sorted_vals) < 2:
        return 0.5
    below = sum(1 for v in sorted_vals if v < val)
    return below / (len(sorted_vals) - 1)


@router.get("/intelligence")
def investment_intelligence(date: str = Query(None)):
    from models.database import SessionLocal
    from sqlalchemy import text
    from collections import defaultdict

    db = SessionLocal()
    try:
        data_date = resolve_date(date)

        rows = db.execute(text("""
            SELECT isin, name, category, asset_class, ranking,
                   return_1y, return_3y, return_5y, return_6m,
                   std_dev_3y, fund_size, morningstar_rating,
                   sharpe_ratio_3y, expense_ratio
            FROM daily_fund_data
            WHERE data_date = :date
              AND nav IS NOT NULL
              AND category = ANY(:cats)
        """), {
            "date":  str(data_date),
            "cats":  INTEL_CATS,
        }).fetchall()

        # Group by category — deduplicate by ISIN first
        seen_isins = set()
        by_cat = defaultdict(list)
        for r in rows:
            d = dict(r._mapping)
            isin = d.get("isin")
            if isin and isin in seen_isins:
                continue
            if isin:
                seen_isins.add(isin)
            by_cat[d["category"]].append(d)

        # ── Build per-category sorted return lists ─────────────────────────
        cat_vals = {}   # cat → { "1y": [...], "3y": [...], "5y": [...], "6m": [...], "std3y": [...] }
        for cat, funds in by_cat.items():
            if len(funds) < MIN_CAT_SIZE:
                continue
            cat_vals[cat] = {
                "1y":   sorted([f["return_1y"]  for f in funds if f["return_1y"]  is not None]),
                "3y":   sorted([f["return_3y"]  for f in funds if f["return_3y"]  is not None]),
                "5y":   sorted([f["return_5y"]  for f in funds if f["return_5y"]  is not None]),
                "6m":   sorted([f["return_6m"]  for f in funds if f["return_6m"]  is not None]),
                "std3y":sorted([f["std_dev_3y"] for f in funds if f["std_dev_3y"] is not None]),
            }

        # ── Compute signals ────────────────────────────────────────────────
        best, improving, deteriorating, hi_risk, consistent = [], [], [], [], []

        for cat, funds in by_cat.items():
            if cat not in cat_vals:
                continue   # < MIN_CAT_SIZE

            cv = cat_vals[cat]

            for f in funds:
                # Percentile ranks — None if the fund is missing that return
                # or if fewer than 5 funds in category have valid data for that metric
                p1   = _pct_of_val(f["return_1y"],  cv["1y"])   if f["return_1y"]  is not None and len(cv["1y"])   >= 5 else None
                p3   = _pct_of_val(f["return_3y"],  cv["3y"])   if f["return_3y"]  is not None and len(cv["3y"])   >= 5 else None
                p5   = _pct_of_val(f["return_5y"],  cv["5y"])   if f["return_5y"]  is not None and len(cv["5y"])   >= 5 else None
                p6m  = _pct_of_val(f["return_6m"],  cv["6m"])   if f["return_6m"]  is not None and len(cv["6m"])   >= 5 else None
                pstd = _pct_of_val(f["std_dev_3y"], cv["std3y"])if f["std_dev_3y"] is not None and len(cv["std3y"])>= 5 else None

                # ── Signal 1: Best performers ──────────────────────────────
                # Need at least 1Y + 3Y. 5Y optional → redistribute weights.
                if p1 is not None and p3 is not None:
                    if p5 is not None:
                        blend = p1 * 0.4 + p3 * 0.4 + p5 * 0.2
                        completeness = "full"
                    else:
                        blend = p1 * 0.5 + p3 * 0.5
                        completeness = "partial"
                    best.append({**f, "__blend": blend, "__completeness": completeness,
                                 "__p1": p1, "__p3": p3, "__p5": p5})

                # ── Signals 2 & 3: Improving / Deteriorating ──────────────
                # 6M percentile − 1Y percentile (recent vs trailing year)
                if p6m is not None and p1 is not None:
                    improve = p6m - p1
                    entry = {**f, "__improve": improve, "__p6m": p6m, "__p1": p1}
                    if improve > IMPROVE_THRESHOLD:
                        improving.append(entry)
                    elif improve < -IMPROVE_THRESHOLD:
                        deteriorating.append(entry)

                # ── Signal 4: High risk / High return ─────────────────────
                # Best return per unit of risk within category.
                # Rank by: return_3y_percentile / std_dev_3y_percentile
                if pstd is not None and p3 is not None and pstd > 0:
                    risk_reward = p3 / pstd
                    hi_risk.append({**f, "__std_pct": pstd, "__ret_pct": p3, "__risk_reward": risk_reward})

                # ── Signal 5: Consistent performers ───────────────────────
                # Requires ALL THREE periods: 1Y + 3Y + 5Y
                # Score = avg_percentile - (dispersion × λ)
                CONSISTENCY_LAMBDA = 0.3
                if p1 is not None and p3 is not None and p5 is not None:
                    avg_p      = (p1 + p3 + p5) / 3
                    dispersion = abs(p1 - p3) + abs(p3 - p5) + abs(p1 - p5)
                    if avg_p >= 0.6:
                        score = avg_p - (dispersion * CONSISTENCY_LAMBDA)
                        consistent.append({**f, "__avg_p": avg_p, "__dispersion": dispersion, "__consistency_score": score})

        # ── Sort & cap at 10 each ──────────────────────────────────────────
        best          = sorted(best,          key=lambda f: f["__blend"],     reverse=True)[:10]
        improving     = sorted(improving,     key=lambda f: f["__improve"],   reverse=True)[:10]
        deteriorating = sorted(deteriorating, key=lambda f: f["__improve"])[:10]
        hi_risk       = sorted(hi_risk,       key=lambda f: f["__risk_reward"],  reverse=True)[:10]
        consistent    = sorted(consistent,    key=lambda f: f["__consistency_score"], reverse=True)[:10]

        # ── Serialise ──────────────────────────────────────────────────────
        def _base(f):
            return {
                "isin":               f["isin"],
                "name":               f["name"],
                "category":           f["category"],
                "ranking":            f.get("ranking") if f.get("ranking") and str(f.get("ranking")) != "0" else None,
                "return_1y":          f.get("return_1y"),
                "return_3y":          f.get("return_3y"),
                "return_5y":          f.get("return_5y"),
                "return_6m":          f.get("return_6m"),
                "std_dev_3y":         f.get("std_dev_3y"),
                "sharpe_3y":          f.get("sharpe_ratio_3y"),
                "expense_ratio":      f.get("expense_ratio"),
                "aum_cr":             f.get("fund_size"),
                "morningstar_rating": f.get("morningstar_rating"),
            }

        def _fmt_best(f):
            return {**_base(f),
                    "blend_pctl":   round(f["__blend"] * 100, 1),
                    "completeness": f["__completeness"]}

        def _fmt_momentum(f):
            return {**_base(f),
                    "momentum":  round(f["__improve"] * 100, 1),
                    "p6m_pctl":  round(f["__p6m"] * 100, 1),
                    "p1y_pctl":  round(f["__p1"]  * 100, 1)}

        def _fmt_hirisk(f):
            return {**_base(f),
                    "std_pctl":    round(f["__std_pct"]    * 100, 1),
                    "ret3y_pctl":  round(f["__ret_pct"]    * 100, 1),
                    "risk_reward": round(f["__risk_reward"]      , 2)}

        def _fmt_consistent(f):
            return {**_base(f),
                    "avg_pctl":          round(f["__avg_p"]             * 100, 1),
                    "dispersion":        round(f["__dispersion"]         * 100, 1),
                    "consistency_score": round(f["__consistency_score"]  * 100, 1)}

        pool_size = sum(len(v) for v in by_cat.values() if len(v) >= MIN_CAT_SIZE)

        return {
            "data_date": str(data_date),
            "pool_size": pool_size,
            "signals": {
                "best":           {"label": "Best Performers",        "icon": "★", "funds": [_fmt_best(f)       for f in best]},
                "improving":      {"label": "Improving Funds",         "icon": "↗", "funds": [_fmt_momentum(f)   for f in improving]},
                "deteriorating":  {"label": "Deteriorating Funds",     "icon": "↘", "funds": [_fmt_momentum(f)   for f in deteriorating]},
                "hi_risk":        {"label": "High Risk / High Return",  "icon": "⚡", "funds": [_fmt_hirisk(f)    for f in hi_risk]},
                "consistent":     {"label": "Consistent Performers",   "icon": "●", "funds": [_fmt_consistent(f) for f in consistent]},
            },
        }

    finally:
        db.close()