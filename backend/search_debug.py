from models.database import SessionLocal, DailyFundData
from datetime import date

db = SessionLocal()
f = db.query(DailyFundData).filter(
    DailyFundData.isin == 'INF179K01574'
).order_by(DailyFundData.data_date.desc()).first()
if f:
    print('date:', f.data_date)
    print('morningstar_category:', f.morningstar_category)
    print('amfi_code:', f.amfi_code)
    print('rta_code:', f.rta_code)
else:
    print('Fund not found')
db.close()