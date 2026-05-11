# routers/chat.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
from google import genai

router = APIRouter()

_api_key = os.getenv("GEMINI_API_KEY")
_client = genai.Client(api_key=_api_key) if _api_key else None

MODEL = "gemini-2.5-flash"

SYSTEM_CONTEXT = """
You are an expert mutual fund and financial analytics assistant for BugleRock Capital,
a wealth and asset management firm based in India.

Your role:
- Answer questions about mutual funds, NAV, risk metrics, returns, and investment concepts
- Explain financial metrics (Sharpe ratio, Alpha, Beta, CAGR, XIRR, etc.) clearly
- Provide specific data-driven analysis using the fund context provided
- Be concise, accurate, and professional
- Use Indian financial context (INR, SEBI, AMFI, NSE, BSE, Morningstar categories)

Rules:
- Never give personalized investment advice or buy/sell recommendations
- Always caveat that past performance is not indicative of future results
- When data is available in context, use actual numbers in your response
- If asked to compare with peers, use the peer data provided
"""


class ChatRequest(BaseModel):
    message: str
    fund_context: Optional[dict] = None
    date: Optional[str] = None


def f(v):
    if v is None or v == '-' or v == 'N/A':
        return 'N/A'
    return str(v)


def build_context_prompt(fc: dict, date: str) -> str:
    if not fc:
        return ""

    snap = fc.get('snapshot') or {}
    perf = fc.get('performance') or {}
    peers_data = fc.get('peers') or {}
    fund = fc.get('fund') or {}

    r    = snap.get('returns') or {}
    risk = snap.get('risk') or {}

    bm      = perf.get('benchmark') or {}
    bm_ret  = bm.get('returns') or {}
    pa      = perf.get('peer_avg') or {}
    pa_ret  = pa.get('returns') or {}
    pa_risk = pa.get('risk') or {}

    peers = peers_data.get('peers') or []

    lines = [
        "=== FUND CONTEXT ===",
        f"Name:               {f(snap.get('name') or fund.get('name'))}",
        f"ISIN:               {f(snap.get('isin') or fund.get('isin'))}",
        f"Category:           {f(snap.get('category') or fund.get('category'))}",
        f"Asset Class:        {f(snap.get('asset_class') or fund.get('assetClass'))}",
        f"Ranking:            {f(snap.get('ranking') or fund.get('ranking'))}",
        f"As of date:         {f(date)}",
        "",
        "--- Valuation ---",
        f"NAV:                ₹{f(snap.get('nav'))} (as of {f(snap.get('nav_date'))})",
        f"52W High NAV:       ₹{f(snap.get('nav_52w_high'))}",
        f"Fund Size:          ₹{f(snap.get('fund_size'))} Cr",
        f"Expense Ratio:      {f(snap.get('expense_ratio'))}%",
        f"Inception Date:     {f(snap.get('inception_date'))}",
        f"Morningstar Rating: {f(snap.get('morningstar_rating'))} stars",
        f"P/E Ratio:          {f(snap.get('pe_ratio'))}",
        f"P/B Ratio:          {f(snap.get('pb_ratio'))}",
        f"Fund Manager:       {f(snap.get('manager_name'))}",
        f"Exit Load:          {f(snap.get('exit_load'))}",
        "",
        "--- Returns (%) — Fund vs Benchmark vs Peer Avg ---",
        f"{'Period':<12} {'Fund':>10} {'Benchmark':>12} {'Peer Avg':>10}",
        f"{'1 Day':<12} {f(r.get('1d')):>10} {f(bm_ret.get('1d')):>12} {f(pa_ret.get('1d')):>10}",
        f"{'1 Week':<12} {f(r.get('1w')):>10} {f(bm_ret.get('1w')):>12} {f(pa_ret.get('1w')):>10}",
        f"{'1 Month':<12} {f(r.get('1m')):>10} {f(bm_ret.get('1m')):>12} {f(pa_ret.get('1m')):>10}",
        f"{'3 Months':<12} {f(r.get('3m')):>10} {f(bm_ret.get('3m')):>12} {f(pa_ret.get('3m')):>10}",
        f"{'6 Months':<12} {f(r.get('6m')):>10} {f(bm_ret.get('6m')):>12} {f(pa_ret.get('6m')):>10}",
        f"{'1 Year':<12} {f(r.get('1y')):>10} {f(bm_ret.get('1y')):>12} {f(pa_ret.get('1y')):>10}",
        f"{'2 Years':<12} {f(r.get('2y')):>10} {f(bm_ret.get('2y')):>12} {f(pa_ret.get('2y')):>10}",
        f"{'3 Years':<12} {f(r.get('3y')):>10} {f(bm_ret.get('3y')):>12} {f(pa_ret.get('3y')):>10}",
        f"{'5 Years':<12} {f(r.get('5y')):>10} {f(bm_ret.get('5y')):>12} {f(pa_ret.get('5y')):>10}",
        f"{'YTD':<12} {f(r.get('ytd')):>10} {f(bm_ret.get('ytd')):>12} {f(pa_ret.get('ytd')):>10}",
        f"{'CY2025':<12} {f(r.get('cy2025')):>10} {f(bm_ret.get('cy2025')):>12} {f(pa_ret.get('cy2025')):>10}",
        f"{'CY2024':<12} {f(r.get('cy2024')):>10} {f(bm_ret.get('cy2024')):>12} {f(pa_ret.get('cy2024')):>10}",
        f"{'CY2023':<12} {f(r.get('cy2023')):>10} {f(bm_ret.get('cy2023')):>12} {f(pa_ret.get('cy2023')):>10}",
        f"{'CY2022':<12} {f(r.get('cy2022')):>10} {f(bm_ret.get('cy2022')):>12} {f(pa_ret.get('cy2022')):>10}",
        f"{'CY2021':<12} {f(r.get('cy2021')):>10} {f(bm_ret.get('cy2021')):>12} {f(pa_ret.get('cy2021')):>10}",
        "",
        f"Benchmark: {f(bm.get('name'))}",
        "",
        "--- Risk Metrics ---",
        f"{'Metric':<22} {'Fund':>10} {'Peer Avg':>10}",
        f"{'Std Dev':<22} {f(risk.get('std_dev')):>10} {f(pa_risk.get('std_dev')):>10}",
        f"{'Alpha':<22} {f(risk.get('alpha')):>10} {f(pa_risk.get('alpha')):>10}",
        f"{'Beta':<22} {f(risk.get('beta')):>10} {f(pa_risk.get('beta')):>10}",
        f"{'Sharpe Ratio':<22} {f(risk.get('sharpe_ratio')):>10} {f(pa_risk.get('sharpe_ratio')):>10}",
        f"{'Sortino Ratio':<22} {f(risk.get('sortino_ratio')):>10} {f(pa_risk.get('sortino_ratio')):>10}",
        f"{'Information Ratio':<22} {f(risk.get('information_ratio')):>10} {f(pa_risk.get('information_ratio')):>10}",
        f"{'Up Capture':<22} {f(risk.get('up_capture')):>10} {f(pa_risk.get('up_capture')):>10}",
        f"{'Down Capture':<22} {f(risk.get('down_capture')):>10} {f(pa_risk.get('down_capture')):>10}",
        "",
        "--- Portfolio Exposure ---",
        f"Large Cap: {f(snap.get('large_cap'))}%  Mid Cap: {f(snap.get('mid_cap'))}%  Small Cap: {f(snap.get('small_cap'))}%",
    ]

    # Add peer comparison
    if peers:
        lines.append("")
        lines.append(f"--- Peer Funds in Category ({len(peers)} R1/R2 funds) ---")
        lines.append(f"{'Fund':<35} {'Rank':>5} {'1Y':>8} {'3Y':>8} {'5Y':>8} {'Sharpe':>8}")
        for p in peers[:10]:  # limit to 10 peers
            pr = (p.get('returns') or {})
            pk = (p.get('risk') or {})
            lines.append(
                f"{str(p.get('name',''))[:34]:<35} "
                f"{f(p.get('ranking')):>5} "
                f"{f(pr.get('1y')):>8} "
                f"{f(pr.get('3y')):>8} "
                f"{f(pr.get('5y')):>8} "
                f"{f(pk.get('sharpe_ratio')):>8}"
            )

    lines.append("===================")
    return "\n".join(lines)


@router.post("/ask")
async def ask_gemini(request: ChatRequest):
    if not _client:
        raise HTTPException(503, "AI service not configured. Please set GEMINI_API_KEY in .env file.")

    context_block = build_context_prompt(request.fund_context, request.date)
    full_prompt = f"{SYSTEM_CONTEXT}\n\n{context_block}\n\nUser question: {request.message}"

    try:
        response = _client.models.generate_content(
            model=MODEL,
            contents=full_prompt,
        )
        return {"response": response.text}
    except Exception as e:
        raise HTTPException(500, f"AI response failed: {str(e)}")