#!/usr/bin/env python3
"""Scheduler — runs poll_updater every Wednesday and Saturday at 20:00 Israel time"""

import schedule, time, subprocess
from datetime import datetime
import pytz

ISRAEL_TZ = pytz.timezone("Asia/Jerusalem")

def job():
    now = datetime.now(ISRAEL_TZ)
    print(f"[{now}] Running poll updater...")
    subprocess.run(["python3", "poll_updater.py"])

# Wednesday = 2, Saturday = 5
schedule.every().wednesday.at("20:00").do(job)
schedule.every().saturday.at("20:00").do(job)

print("Scheduler running — polls update every Wednesday and Saturday at 20:00 Israel time")
print("Next runs:", schedule.next_run())

while True:
    schedule.run_pending()
    time.sleep(60)
