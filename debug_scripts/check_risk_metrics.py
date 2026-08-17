import sys
from pathlib import Path
BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")
from sqlalchemy import text
from models.database import engine

with engine.connect() as conn:
    latest = conn.execute(text(
        "SELECT MAX(data_date) FROM daily_fund_data WHERE is_benchmark = 0 OR is_benchmark IS NULL"
    )).scalar()
    print(f"Latest data_date: {latest}\n")

    total = conn.execute(text(
        "SELECT COUNT(*) FROM daily_fund_data WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)"
    ), {"d": latest}).scalar()

    for col in ["std_dev_3y", "sharpe_ratio_3y", "sortino_ratio_3y",
                "beta_3y", "alpha_3y", "up_capture_3y", "down_capture_3y"]:
        has = conn.execute(text(f"""
            SELECT COUNT(*) FROM daily_fund_data
            WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)
            AND {col} IS NOT NULL
        """), {"d": latest}).scalar()
        print(f"{col:<25} {has:>5}/{total} ({100*has/total:.0f}%)")

    # Sample a fund that has these values
    print("\nSample fund with risk metrics:")
    sample = conn.execute(text("""
        SELECT isin, name, std_dev_3y, sharpe_ratio_3y, beta_3y, alpha_3y
        FROM daily_fund_data
        WHERE data_date = :d AND std_dev_3y IS NOT NULL
          AND (is_benchmark = 0 OR is_benchmark IS NULL)
        LIMIT 3
    """), {"d": latest}).fetchall()
    for r in sample:
        print(f"  {r[0]} {r[1][:40]:<40} std={r[2]} sharpe={r[3]} beta={r[4]} alpha={r[5]}")