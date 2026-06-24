from dotenv import load_dotenv
load_dotenv()
from services.db_service import set_setting
from datetime import date

set_setting("mail_date", str(date.today()))
print(f"mail_date updated to {date.today()}")