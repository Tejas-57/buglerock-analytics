# backend/routers/optimise.py
# Add to main.py:
#   from routers import optimise
#   app.include_router(optimise.router, prefix="/api")

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Optional
from services.optimiser import optimise_portfolio

router = APIRouter()


class FundInput(BaseModel):
    isin: str
    name: str
    weight: float
    category: str
    asset_class: Optional[str] = 'Equity'
    ranking: Optional[str] = None
    small_cap_pct: Optional[float] = None
    mid_cap_pct:   Optional[float] = None
    large_cap_pct: Optional[float] = None

    class Config:
        coerce_numbers_to_str = False

    def __init__(self, **data):
        for field in ('small_cap_pct', 'mid_cap_pct', 'large_cap_pct'):
            if field in data and data[field] is not None:
                try:
                    data[field] = float(data[field])
                except (ValueError, TypeError):
                    data[field] = None
        super().__init__(**data)


class IPSConstraints(BaseModel):
    riskProfile: Optional[str] = "Moderate"
    equity: Optional[Dict] = {"min": 40, "max": 60}
    debt: Optional[Dict] = {"min": 30, "max": 50}
    largeCap: Optional[Dict] = {"min": 40, "max": 70}
    midCap: Optional[Dict] = {"min": 0, "max": 35}
    smallCap: Optional[Dict] = {"min": 0, "max": 20}


class ConfigInput(BaseModel):
    objective:          Optional[str]   = 'max_sharpe'
    nSims:              Optional[int]   = 5000
    respectIPS:         Optional[bool]  = True
    minW:               Optional[float] = 5.0
    maxW:               Optional[float] = 40.0
    maxVol:             Optional[float] = None
    minComm:            Optional[float] = None
    maxComm:            Optional[float] = None
    maxSc:              Optional[float] = None
    minIntl:            Optional[float] = None
    maxIntl:            Optional[float] = None
    capPreciousMetals:  Optional[float] = 10.0
    capPassive:         Optional[float] = 10.0
    capInternational:   Optional[float] = 10.0
    capThematic:        Optional[float] = 10.0


class OptimiseRequest(BaseModel):
    funds: List[FundInput]
    ips: Optional[IPSConstraints] = None
    config: Optional[ConfigInput] = None
    manual_weights: Optional[Dict[str, float]] = {}
    date: Optional[str] = None


@router.post("/portfolio/optimise")
def optimise(request: OptimiseRequest):
    cfg = request.config or ConfigInput()
    payload = {
        "funds": [
            {
                "isin":           f.isin,
                "name":           f.name,
                "current_weight": f.weight,
                "category":       f.category,
                "asset_class":    f.asset_class,
                "ranking":        f.ranking,
                "small_cap_pct":  f.small_cap_pct,
                "mid_cap_pct":    f.mid_cap_pct,
                "large_cap_pct":  f.large_cap_pct,
            }
            for f in request.funds
        ],
        "ips":            request.ips.dict() if request.ips else {},
        "config": {
            "objective":         cfg.objective,
            "n_sims":            cfg.nSims,
            "min_w":             cfg.minW / 100 if cfg.minW is not None else 0.05,
            "max_w":             cfg.maxW / 100 if cfg.maxW is not None else 0.40,
            "max_vol":           cfg.maxVol,
            "max_sc":            cfg.maxSc,
            "min_intl":          cfg.minIntl,
            "max_intl":          cfg.maxIntl,
            "cap_precious":      cfg.capPreciousMetals / 100 if cfg.capPreciousMetals is not None else 0.10,
            "cap_passive":       cfg.capPassive / 100 if cfg.capPassive is not None else 0.10,
            "cap_international": cfg.capInternational / 100 if cfg.capInternational is not None else 0.10,
            "cap_thematic":      cfg.capThematic / 100 if cfg.capThematic is not None else 0.10,
        },
        "manual_weights": request.manual_weights or {},
        "date":           request.date,
    }
    return optimise_portfolio(payload)