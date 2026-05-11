"""
benchmark_tickers.py
Maps Morningstar benchmark names to Yahoo Finance tickers.
Used for equity and equity ETF categories only.
Matching is done by checking if any key is a substring of the benchmark name (case-insensitive).
"""

BENCHMARK_TICKER_MAP = {
    # Nifty broad indices
    "Nifty 50":                    "^NSEI",
    "BSE SENSEX":                  "^BSESN",
    "Nifty 100":                   "^CNX100",
    "Nifty 500":                   "^CRSLDX",
    "Nifty Next 50":               "^NSMIDCP50",
    "Nifty LargeMidcap 250":       "^NSELM250",

    # Midcap / Smallcap
    "Nifty Midcap 150":            "^NSEMDCP150",
    "NIFTY Midcap 100":            "^NSEMDCP100",
    "Nifty Smallcap 250":          "^NSESC250",
    "NIFTY Smallcap 100":          "^NSESC100",

    # Sectoral
    "Nifty Bank":                  "^NSEBANK",
    "Nifty IT":                    "^CNXIT",
    "Nifty Financial Services":    "^CNXFIN",
    "Nifty Healthcare":            "^CNXPHARMA",
    "Nifty Energy":                "^CNXENERGY",
    "Nifty India Consumption":     "^CNXCONSUM",
    "Nifty MNC":                   "^CNXMNC",
    "Nifty Div Opportunities":     "^CNXDIVOP",

    # International
    "S&P 500":                     "^GSPC",
    "MSCI World":                  "URTH",
    "MSCI EM EMEA":                "EEM",
    "FTSE 100":                    "^FTSE",
    "Hang Seng":                   "^HSI",

    # Commodity ETFs — only when these are the benchmark
    "Silver":                      "SILVERIETF.NS",
    "Gold":                        "SETFGOLD.NS",
}

# Asset classes for which benchmark fetching is enabled
BENCHMARK_ENABLED_ASSET_CLASSES = {"Equity", "ETF - Equity"}


def get_ticker_for_benchmark(benchmark_name: str) -> str | None:
    """
    Fuzzy match benchmark_name against BENCHMARK_TICKER_MAP keys.
    Returns Yahoo Finance ticker or None if no match found.
    """
    if not benchmark_name:
        return None
    bm_lower = benchmark_name.lower()
    for key, ticker in BENCHMARK_TICKER_MAP.items():
        if key.lower() in bm_lower:
            return ticker
    return None