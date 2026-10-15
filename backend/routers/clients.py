"""
Client Investment Profile — backend router.
Manages client records: create, list, get, update.

Table: clients
  - id (UUID)
  - name, pan, email, rm_name
  - tax_status, investment_amount, sip, stepup
  - objective, horizon, liquidity_need, income_requirement
  - source_of_funds, next_review_date
  - profile_mode: 'full' | 'existing' | 'indicative'
  - risk_profile: 'conservative' | 'mod_conservative' | 'balanced' | 'mod_aggressive' | 'aggressive'
  - suitability_status: 'draft' | 'indicative' | 'assessed' | 'approved' | 'review_due' | 'expired'
  - willingness_score, capacity_score, overall_score
  - willingness_answers (JSON), capacity_answers (JSON)
  - constraints (JSON)
  - assessment_date, valid_until
  - created_by (user email)
  - created_at, updated_at
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from auth.middleware.auth_middleware import get_current_user
from sqlalchemy.orm import Session
from sqlalchemy import text
from models.database import SessionLocal
from datetime import datetime
import uuid
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_clients_table(db: Session):
    """Create clients table if it doesn't exist."""
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS clients (
            id                  VARCHAR(36) PRIMARY KEY,
            name                VARCHAR(200) NOT NULL,
            pan                 VARCHAR(20),
            email               VARCHAR(200),
            rm_name             VARCHAR(200),
            tax_status          VARCHAR(50) DEFAULT 'Resident individual',
            investment_amount   BIGINT,
            sip                 BIGINT,
            stepup              INTEGER,
            objective           VARCHAR(100) DEFAULT 'Wealth creation',
            horizon             VARCHAR(20),
            liquidity_need      VARCHAR(100),
            income_requirement  VARCHAR(20) DEFAULT 'none',
            source_of_funds     VARCHAR(100),
            next_review_date    DATE,
            profile_mode        VARCHAR(20),
            risk_profile        VARCHAR(30),
            suitability_status  VARCHAR(20) DEFAULT 'draft',
            willingness_score   INTEGER,
            capacity_score      INTEGER,
            overall_score       INTEGER,
            constrained_by      VARCHAR(20),
            willingness_answers TEXT DEFAULT '{}',
            capacity_answers    TEXT DEFAULT '{}',
            constraints_json    TEXT DEFAULT '{}',
            assessment_date     DATE,
            valid_until         DATE,
            assessment_basis    TEXT,
            created_by          VARCHAR(200),
            created_at          TIMESTAMP DEFAULT NOW(),
            updated_at          TIMESTAMP DEFAULT NOW()
        )
    """))
    db.commit()


def _row_to_dict(row) -> dict:
    d = dict(row._mapping)
    for field in ['willingness_answers', 'capacity_answers', 'constraints_json']:
        if isinstance(d.get(field), str):
            try:
                d[field] = json.loads(d[field])
            except Exception:
                d[field] = {}
    # Rename constraints_json → constraints for frontend
    d['constraints'] = d.pop('constraints_json', {})
    # Dates to ISO strings
    for f in ['next_review_date', 'assessment_date', 'valid_until', 'created_at', 'updated_at']:
        if d.get(f) and not isinstance(d[f], str):
            d[f] = d[f].isoformat()
    return d


@router.get("/clients")
def list_clients(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _migrate_clients_table(db)
    rows = db.execute(text("""
        SELECT * FROM clients
        WHERE created_by = :email OR created_by IS NULL
        ORDER BY updated_at DESC
    """), {"email": current_user["email"]}).fetchall()
    # Backfill created_by for any null rows — claim them for this user
    db.execute(text("""
        UPDATE clients SET created_by = :email WHERE created_by IS NULL
    """), {"email": current_user["email"]})
    db.commit()
    return {"clients": [_row_to_dict(r) for r in rows]}


@router.get("/clients/{client_id}")
def get_client(client_id: str, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _migrate_clients_table(db)
    row = db.execute(text("SELECT * FROM clients WHERE id = :id AND created_by = :email"),
                     {"id": client_id, "email": current_user["email"]}).fetchone()
    if not row:
        raise HTTPException(404, f"Client {client_id} not found")
    return _row_to_dict(row)


@router.post("/clients")
def create_client(body: dict, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _migrate_clients_table(db)
    client_id = str(uuid.uuid4())
    now = datetime.utcnow()
    db.execute(text("""
        INSERT INTO clients (
            id, name, pan, email, rm_name, tax_status,
            investment_amount, sip, objective, horizon,
            liquidity_need, income_requirement, source_of_funds,
            next_review_date, profile_mode, risk_profile,
            suitability_status, willingness_answers, capacity_answers,
            constraints_json, assessment_date, valid_until, assessment_basis,
            created_by, created_at, updated_at
        ) VALUES (
            :id, :name, :pan, :email, :rm_name, :tax_status,
            :investment_amount, :sip, :objective, :horizon,
            :liquidity_need, :income_requirement, :source_of_funds,
            :next_review_date, :profile_mode, :risk_profile,
            :suitability_status, :willingness_answers, :capacity_answers,
            :constraints_json, :assessment_date, :valid_until, :assessment_basis,
            :created_by, :created_at, :updated_at
        )
    """), {
        "id": client_id,
        "name": body.get("name", ""),
        "pan": body.get("pan"),
        "email": body.get("email"),
        "rm_name": body.get("rm_name"),
        "tax_status": body.get("tax_status", "Resident individual"),
        "investment_amount": body.get("investment_amount"),
        "sip": body.get("sip"),
        "objective": body.get("objective", "Wealth creation"),
        "horizon": body.get("horizon"),
        "liquidity_need": body.get("liquidity_need"),
        "income_requirement": body.get("income_requirement", "none"),
        "source_of_funds": body.get("source_of_funds"),
        "next_review_date": body.get("next_review_date"),
        "profile_mode": body.get("profile_mode"),
        "risk_profile": body.get("risk_profile"),
        "suitability_status": body.get("suitability_status", "draft"),
        "willingness_answers": json.dumps(body.get("willingness_answers", {})),
        "capacity_answers": json.dumps(body.get("capacity_answers", {})),
        "constraints_json": json.dumps(body.get("constraints", {})),
        "assessment_date": body.get("assessment_date"),
        "valid_until": body.get("valid_until"),
        "assessment_basis": body.get("assessment_basis"),
        "created_by": current_user["email"],
        "created_at": now,
        "updated_at": now,
    })
    db.commit()
    row = db.execute(text("SELECT * FROM clients WHERE id = :id"), {"id": client_id}).fetchone()
    return _row_to_dict(row)


@router.put("/clients/{client_id}")
def update_client(client_id: str, body: dict, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _migrate_clients_table(db)
    row = db.execute(text("SELECT id FROM clients WHERE id = :id AND created_by = :email"),
                     {"id": client_id, "email": current_user["email"]}).fetchone()
    if not row:
        raise HTTPException(404, f"Client {client_id} not found")

    updates = {
        "name": body.get("name"),
        "pan": body.get("pan"),
        "email": body.get("email"),
        "rm_name": body.get("rm_name"),
        "tax_status": body.get("tax_status"),
        "investment_amount": body.get("investment_amount"),
        "sip": body.get("sip"),
        "objective": body.get("objective"),
        "horizon": body.get("horizon"),
        "liquidity_need": body.get("liquidity_need"),
        "income_requirement": body.get("income_requirement"),
        "source_of_funds": body.get("source_of_funds"),
        "next_review_date": body.get("next_review_date"),
        "profile_mode": body.get("profile_mode"),
        "risk_profile": body.get("risk_profile"),
        "suitability_status": body.get("suitability_status"),
        "willingness_score": body.get("willingness_score"),
        "capacity_score": body.get("capacity_score"),
        "overall_score": body.get("overall_score"),
        "constrained_by": body.get("constrained_by"),
        "willingness_answers": json.dumps(body.get("willingness_answers", {})) if "willingness_answers" in body else None,
        "capacity_answers": json.dumps(body.get("capacity_answers", {})) if "capacity_answers" in body else None,
        "constraints_json": json.dumps(body.get("constraints", {})) if "constraints" in body else None,
        "assessment_date": body.get("assessment_date"),
        "valid_until": body.get("valid_until"),
        "assessment_basis": body.get("assessment_basis"),
        "updated_at": datetime.utcnow(),
    }

    # Build SET clause for non-None values
    set_parts = []
    params = {"id": client_id}
    for k, v in updates.items():
        if v is not None:
            set_parts.append(f"{k} = :{k}")
            params[k] = v

    if set_parts:
        db.execute(text(f"UPDATE clients SET {', '.join(set_parts)} WHERE id = :id"), params)
        db.commit()

    row = db.execute(text("SELECT * FROM clients WHERE id = :id"), {"id": client_id}).fetchone()
    return _row_to_dict(row)


@router.delete("/clients/{client_id}")
def delete_client(client_id: str, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _migrate_clients_table(db)
    db.execute(text("DELETE FROM clients WHERE id = :id AND created_by = :email"),
               {"id": client_id, "email": current_user["email"]})
    db.commit()
    return {"ok": True}