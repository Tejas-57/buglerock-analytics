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
    weight: float          # current weight %
    category: str
    asset_class: Optional[str] = 'Equity'
    ranking: Optional[str] = None


class IPSConstraints(BaseModel):
    riskProfile: Optional[str] = "Moderate"
    equity: Optional[Dict] = {"min": 40, "max": 60}
    debt: Optional[Dict] = {"min": 30, "max": 50}
    largeCap: Optional[Dict] = {"min": 40, "max": 70}
    midCap: Optional[Dict] = {"min": 0, "max": 35}
    smallCap: Optional[Dict] = {"min": 0, "max": 20}


class OptimiseRequest(BaseModel):
    funds: List[FundInput]
    ips: Optional[IPSConstraints] = None
    manual_weights: Optional[Dict[str, float]] = {}  # {isin: weight_pct}
    date: Optional[str] = None


@router.post("/portfolio/optimise")
def optimise(request: OptimiseRequest):
    payload = {
        "funds": [
            {
                "isin":         f.isin,
                "name":         f.name,
                "current_weight": f.weight,
                "category":     f.category,
                "asset_class":  f.asset_class,
                "ranking":      f.ranking,
            }
            for f in request.funds
        ],
        "ips":            request.ips.dict() if request.ips else {},
        "manual_weights": request.manual_weights or {},
        "date":           request.date,
    }
    return optimise_portfolio(payload)