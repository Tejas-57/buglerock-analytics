# backend/routers/proposal.py
"""
Portfolio proposal generation endpoints.
POST /api/proposal/pptx  — generates and streams a .pptx file
"""

import json
import subprocess
import tempfile
import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any

router = APIRouter()

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "generate_proposal_pptx.js"


class SnapshotRisk(BaseModel):
    sharpe_ratio_3y: Optional[float] = None
    sortino_ratio_3y: Optional[float] = None
    alpha_3y: Optional[float] = None
    beta_3y: Optional[float] = None
    up_capture_3y: Optional[float] = None
    down_capture_3y: Optional[float] = None
    std_dev_3y: Optional[float] = None


class SnapshotReturns(BaseModel):
    model_config = {"extra": "allow"}


class Snapshot(BaseModel):
    expense_ratio: Optional[float] = None
    large_cap: Optional[float] = None
    mid_cap: Optional[float] = None
    small_cap: Optional[float] = None
    equity_pct: Optional[float] = None
    bond_pct: Optional[float] = None
    cash_pct: Optional[float] = None
    risk: Optional[Dict[str, Any]] = None
    returns: Optional[Dict[str, Any]] = None


class Fund(BaseModel):
    isin: str
    name: str
    category: Optional[str] = None
    color: Optional[str] = None


class BlendedMetrics(BaseModel):
    model_config = {"extra": "allow"}
    ret1y: Optional[float] = None
    ret3y: Optional[float] = None
    ret5y: Optional[float] = None
    ret1m: Optional[float] = None
    ret3m: Optional[float] = None
    ytd: Optional[float] = None
    cy25: Optional[float] = None
    cy24: Optional[float] = None
    cy23: Optional[float] = None
    cy22: Optional[float] = None
    cy21: Optional[float] = None
    sharpe: Optional[float] = None
    sortino: Optional[float] = None
    alpha: Optional[float] = None
    beta: Optional[float] = None
    upcap: Optional[float] = None
    dncap: Optional[float] = None
    std3y: Optional[float] = None
    er: Optional[float] = None
    lc: Optional[float] = None
    mc: Optional[float] = None
    sc: Optional[float] = None
    eq_pct: Optional[float] = None
    bond_pct: Optional[float] = None
    cash_pct: Optional[float] = None


class BmRets(BaseModel):
    model_config = {"extra": "allow"}
    r1y: Optional[float] = None
    r3y: Optional[float] = None
    r5y: Optional[float] = None
    r1m: Optional[float] = None
    r3m: Optional[float] = None
    ytd: Optional[float] = None


class ProposalRequest(BaseModel):
    # Client info
    client: str = "Client"
    rm: Optional[str] = "BugleRock Capital"
    invest: Optional[str] = None
    goal: Optional[str] = "Wealth creation"
    risk: Optional[str] = "Moderate"
    tenure: Optional[int] = 10
    deploy: Optional[str] = None
    targetRet: Optional[str] = None
    reviewFreq: Optional[str] = "Quarterly"
    constraints: Optional[str] = None
    notes: Optional[str] = None
    today: str = ""
    benchmarkName: str = "Benchmark"

    # Portfolio
    funds: list[Fund] = []
    weights: Dict[str, float] = {}
    snapshots: Dict[str, Dict[str, Any]] = {}

    # Blended metrics (pre-computed on frontend)
    B: Dict[str, Any] = {}
    bmRets: Dict[str, Any] = {}

    # Financials
    sipAmt: float = 0
    investAmt: float = 1000000
    tenureYrs: int = 10


@router.post("/pptx")
async def generate_pptx(req: ProposalRequest):
    """Generate a .pptx portfolio proposal and stream it as a download."""
    if not SCRIPT_PATH.exists():
        raise HTTPException(500, f"PPTX generator script not found at {SCRIPT_PATH}")

    node_path = _find_node()
    if not node_path:
        raise HTTPException(500, "Node.js not found on server — cannot generate PPTX")

    # Auto-install pptxgenjs if node_modules missing (first run on Render)
    scripts_dir = SCRIPT_PATH.parent
    node_modules = scripts_dir.parent / "node_modules"
    if not node_modules.exists():
        pkg_json = scripts_dir.parent / "package.json"
        if pkg_json.exists():
            subprocess.run(["npm", "install", "--prefix", str(scripts_dir.parent)], capture_output=True)

    payload = req.model_dump()

    try:
        result = subprocess.run(
            [node_path, str(SCRIPT_PATH)],
            input=json.dumps(payload).encode('utf-8'),
            capture_output=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "PPTX generation timed out")

    if result.returncode != 0:
        err = result.stderr.decode("utf-8", errors="replace")
        raise HTTPException(500, f"PPTX generation failed: {err[:500]}")

    pptx_bytes = result.stdout
    if not pptx_bytes:
        err = result.stderr.decode("utf-8", errors="replace")
        raise HTTPException(500, f"PPTX generator produced no output: {err[:500]}")

    filename = f"BugleRock_Proposal_{req.client.replace(' ','_')}.pptx"

    return StreamingResponse(
        iter([pptx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _find_node():
    """Find node binary — works on Linux (Render) and Windows (local)."""
    import shutil, sys
    # shutil.which searches PATH correctly on all platforms
    node = shutil.which("node")
    if node:
        return node
    # Explicit fallbacks for Linux
    for candidate in ["/usr/bin/node", "/usr/local/bin/node"]:
        if Path(candidate).exists():
            return candidate
    return None