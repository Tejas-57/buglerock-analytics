"""
Client portfolios — backend router.
Saves portfolios against a client. A client can hold several portfolios side by side; each portfolio
keeps every saved version.

Table: client_portfolios
  - id (UUID), client_id -> clients.id (cascade delete)
  - portfolio_key (UUID shared by all versions of one portfolio), name
  - source: 'model' | 'custom' | 'retirement'
  - version (1, 2, ...), is_latest (true on the newest version of each portfolio)
  - model_key (set when source = 'model')
  - summary_json: small payload the dashboard card shows
  - snapshot_json: full frozen state used to reopen the portfolio
  - note, created_by, created_at

Every endpoint checks that the client belongs to the logged-in user.
"""
from fastapi import APIRouter, Depends, HTTPException
from auth.middleware.auth_middleware import get_current_user
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from models.database import SessionLocal
from routers.clients import _migrate_clients_table
from datetime import datetime
import uuid
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

SOURCES = {"model", "custom", "retirement"}
MAX_SNAPSHOT_BYTES = 2_000_000


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_portfolios_table(db: Session):
    """Create client_portfolios if it doesn't exist (clients must exist first for the foreign key)."""
    _migrate_clients_table(db)
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS client_portfolios (
            id             VARCHAR(36)  PRIMARY KEY,
            client_id      VARCHAR(36)  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            portfolio_key  VARCHAR(36)  NOT NULL,
            name           VARCHAR(200) NOT NULL,
            source         VARCHAR(20)  NOT NULL,
            version        INTEGER      NOT NULL DEFAULT 1,
            is_latest      BOOLEAN      NOT NULL DEFAULT TRUE,
            model_key      VARCHAR(30),
            summary_json   TEXT         DEFAULT '{}',
            snapshot_json  TEXT         DEFAULT '{}',
            note           TEXT,
            created_by     VARCHAR(200),
            created_at     TIMESTAMP    DEFAULT NOW(),
            UNIQUE (portfolio_key, version)
        )
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_client_portfolios_client
            ON client_portfolios (client_id, is_latest)
    """))
    db.commit()


def _own_client(db: Session, client_id: str, email: str):
    row = db.execute(text("SELECT id FROM clients WHERE id = :id AND created_by = :email"),
                     {"id": client_id, "email": email}).fetchone()
    if not row:
        raise HTTPException(404, f"Client {client_id} not found")


def _load_json(value, fallback):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return fallback
    return value if value is not None else fallback


def _row_to_dict(row, with_snapshot: bool = False) -> dict:
    d = dict(row._mapping)
    d["summary"] = _load_json(d.pop("summary_json", None), {})
    snapshot = d.pop("snapshot_json", None)
    if with_snapshot:
        d["snapshot"] = _load_json(snapshot, {})
    if d.get("created_at") and not isinstance(d["created_at"], str):
        d["created_at"] = d["created_at"].isoformat()
    return d


# Listings leave the snapshot out: it can be large and the dashboard only needs the summary.
LIST_COLS = ("id, client_id, portfolio_key, name, source, version, is_latest, model_key, "
             "summary_json, note, created_by, created_at")


@router.get("/clients/{client_id}/portfolios")
def list_portfolios(client_id: str, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Latest version of each portfolio the client holds, newest first."""
    _migrate_portfolios_table(db)
    _own_client(db, client_id, current_user["email"])
    rows = db.execute(text(f"""
        SELECT {LIST_COLS} FROM client_portfolios
        WHERE client_id = :cid AND is_latest = TRUE
        ORDER BY created_at DESC
    """), {"cid": client_id}).fetchall()
    return {"portfolios": [_row_to_dict(r) for r in rows]}


@router.get("/clients/{client_id}/portfolios/{portfolio_key}")
def list_versions(client_id: str, portfolio_key: str, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Every saved version of one portfolio, newest first (summaries only)."""
    _migrate_portfolios_table(db)
    _own_client(db, client_id, current_user["email"])
    rows = db.execute(text(f"""
        SELECT {LIST_COLS} FROM client_portfolios
        WHERE client_id = :cid AND portfolio_key = :pk
        ORDER BY version DESC
    """), {"cid": client_id, "pk": portfolio_key}).fetchall()
    if not rows:
        raise HTTPException(404, "Portfolio not found")
    return {"versions": [_row_to_dict(r) for r in rows]}


@router.get("/clients/{client_id}/portfolios/{portfolio_key}/versions/{version}")
def get_version(client_id: str, portfolio_key: str, version: int, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """One version including its full snapshot."""
    _migrate_portfolios_table(db)
    _own_client(db, client_id, current_user["email"])
    row = db.execute(text("""
        SELECT * FROM client_portfolios
        WHERE client_id = :cid AND portfolio_key = :pk AND version = :v
    """), {"cid": client_id, "pk": portfolio_key, "v": version}).fetchone()
    if not row:
        raise HTTPException(404, "Portfolio version not found")
    return _row_to_dict(row, with_snapshot=True)


@router.post("/clients/{client_id}/portfolios")
def save_portfolio(client_id: str, body: dict, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Save a portfolio for the client.
      - no portfolio_key in the body: starts a new portfolio (version 1); name is required
      - portfolio_key in the body: adds the next version to that portfolio; name and source are kept
    """
    _migrate_portfolios_table(db)
    _own_client(db, client_id, current_user["email"])

    summary = body.get("summary") or {}
    snapshot = body.get("snapshot") or {}
    snapshot_json = json.dumps(snapshot)
    if len(snapshot_json) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Snapshot is too large to save")

    portfolio_key = body.get("portfolio_key")
    if portfolio_key:
        latest = db.execute(text("""
            SELECT name, source, model_key, version FROM client_portfolios
            WHERE client_id = :cid AND portfolio_key = :pk AND is_latest = TRUE
        """), {"cid": client_id, "pk": portfolio_key}).fetchone()
        if not latest:
            raise HTTPException(404, "Portfolio not found")
        name, source, version = latest.name, latest.source, latest.version + 1
        if body.get("source") and body["source"] != source:
            raise HTTPException(400, f"This portfolio was saved from '{source}'; a new version must use the same source")
        model_key = body.get("model_key") or latest.model_key
    else:
        name = (body.get("name") or "").strip()
        source = body.get("source")
        if not name:
            raise HTTPException(400, "name is required")
        if len(name) > 200:
            raise HTTPException(400, "name is too long")
        if source not in SOURCES:
            raise HTTPException(400, f"source must be one of {sorted(SOURCES)}")
        portfolio_key = str(uuid.uuid4())
        version = 1
        model_key = body.get("model_key")

    if source == "model" and not model_key:
        raise HTTPException(400, "model_key is required for a model portfolio")

    new_id = str(uuid.uuid4())
    try:
        # The newest version is the only one flagged is_latest; both writes commit together.
        db.execute(text("""
            UPDATE client_portfolios SET is_latest = FALSE
            WHERE client_id = :cid AND portfolio_key = :pk
        """), {"cid": client_id, "pk": portfolio_key})
        db.execute(text("""
            INSERT INTO client_portfolios (
                id, client_id, portfolio_key, name, source, version, is_latest,
                model_key, summary_json, snapshot_json, note, created_by, created_at
            ) VALUES (
                :id, :cid, :pk, :name, :source, :version, TRUE,
                :model_key, :summary_json, :snapshot_json, :note, :created_by, :created_at
            )
        """), {
            "id": new_id, "cid": client_id, "pk": portfolio_key, "name": name, "source": source,
            "version": version, "model_key": model_key,
            "summary_json": json.dumps(summary), "snapshot_json": snapshot_json,
            "note": body.get("note"), "created_by": current_user["email"], "created_at": datetime.utcnow(),
        })
        db.commit()
    except IntegrityError:
        # Two saves raced for the same version number
        db.rollback()
        raise HTTPException(409, "This portfolio was just updated elsewhere. Reload and save again.")

    row = db.execute(text(f"SELECT {LIST_COLS} FROM client_portfolios WHERE id = :id"), {"id": new_id}).fetchone()
    return _row_to_dict(row)


@router.delete("/clients/{client_id}/portfolios/{portfolio_key}")
def delete_portfolio(client_id: str, portfolio_key: str, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete a portfolio and all of its versions."""
    _migrate_portfolios_table(db)
    _own_client(db, client_id, current_user["email"])
    db.execute(text("DELETE FROM client_portfolios WHERE client_id = :cid AND portfolio_key = :pk"),
               {"cid": client_id, "pk": portfolio_key})
    db.commit()
    return {"ok": True}
