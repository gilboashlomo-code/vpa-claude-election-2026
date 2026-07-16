#!/usr/bin/env python3
"""
Poll Updater — Auto-updates voter2026.com with latest Israeli election polls
Runs every Wednesday and Saturday at 20:00 Israel time
Sources: Channels 11, 12, 13, Maariv, Israel Hayom, Walla
"""

import os, re, json, base64, smtplib, requests
from datetime import datetime
from email.mime.text import MIMEText
from anthropic import Anthropic

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO  = "gilboashlomo-code/HASEKER-"
GITHUB_FILE  = "index.html"
EMAIL_TO     = "gilboa.shlomo@gmail.com"
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

client = Anthropic(api_key=ANTHROPIC_KEY)

SOURCES = [
    "https://www.kan.org.il/lobby/skarim/",
    "https://www.mako.co.il/news-politics",
    "https://www.keshet-tv.com/news/",
    "https://www.maariv.co.il/elections",
    "https://www.israelhayom.co.il/elections",
    "https://walla.co.il/politics"
]

def fetch_polls():
    """Use Claude to search and extract latest poll data"""
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[{
            "role": "user",
            "content": """חפש את סקרי המנדטים העדכניים ביותר מערוצי 11, 12, 13, מעריב, ישראל היום ווואלה.
            
            החזר JSON בלבד בפורמט הזה (ללא טקסט נוסף):
            {
              "date": "DD/MM/YYYY",
              "parties": [
                {"name": "שם מפלגה (שם מנהיג)", "mandates": 22.5},
                ...
              ],
              "below_threshold": [
                {"name": "שם מפלגה", "percent": 1.5},
                ...
              ],
              "total": 120,
              "sources": ["ערוץ 12", "ערוץ 13", ...]
            }
            
            חשוב:
            - מיין לפי גודל מהגדול לקטן
            - השתמש בחלקי מנדטים
            - וודא שהסכום = 120
            - כלול רק מפלגות שעוברות אחוז חסימה
            """
        }]
    )
    
    # Extract JSON from response
    for block in msg.content:
        if hasattr(block, 'text'):
            text = block.text
            # Find JSON in response
            match = re.search(r'\{[\s\S]+\}', text)
            if match:
                try:
                    return json.loads(match.group())
                except:
                    pass
    return None

def get_current_file():
    """Get current index.html from GitHub"""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_FILE}"
    r = requests.get(url, headers={"Authorization": f"token {GITHUB_TOKEN}"})
    data = r.json()
    content = base64.b64decode(data["content"]).decode("utf-8")
    sha = data["sha"]
    return content, sha

def update_phonebars(html, polls):
    """Replace phoneBars array in HTML with new poll data"""
    colors = ['#38bdf8','#818cf8','#22d3ee','#fb7185','#60a5fa',
              '#f97316','#fb923c','#c084fc','#f43f5e','#34d399','#a3e635',
              '#facc15','#e879f9']
    
    bars = []
    for i, p in enumerate(polls["parties"]):
        color = colors[i % len(colors)]
        name = p["name"].replace("'", "\\'")
        bars.append(f"    {{n:'{name}',s:{p['mandates']},c:'{color}'}}")
    
    # Add below threshold
    for p in polls.get("below_threshold", []):
        name = p["name"].replace("'", "\\'")
        bars.append(f"    {{n:'{name}',s:0,c:'#475569',p:'{p['percent']}%'}}")
    
    new_block = "  var phoneBars = [\n" + ",\n".join(bars) + "\n  ]"
    
    start = html.find("  var phoneBars = [")
    end = html.find("].map(function(r){", start) + 1
    
    if start == -1:
        print("ERROR: phoneBars not found in HTML")
        return html
    
    return html[:start] + new_block + html[end:]

def update_date_header(html, date_str):
    """Update the survey date in header"""
    import re
    html = re.sub(
        r'עדכון אחרון: \d+/\d+/\d+',
        f'עדכון אחרון: {date_str}',
        html
    )
    return html

def push_to_github(content, sha, message):
    """Push updated file to GitHub"""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_FILE}"
    encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")
    payload = {
        "message": message,
        "content": encoded,
        "sha": sha
    }
    r = requests.put(url, 
                     headers={"Authorization": f"token {GITHUB_TOKEN}"},
                     json=payload)
    return r.status_code == 200

def send_email(polls):
    """Send confirmation email"""
    rows = "\n".join([f"{p['name']}: {p['mandates']}" for p in polls["parties"]])
    below = "\n".join([f"{p['name']}: {p['percent']}%" for p in polls.get("below_threshold", [])])
    
    body = f"""עדכון סקר אוטומטי — {polls['date']}

מקורות: {', '.join(polls.get('sources', []))}

מפלגות (לפי גודל):
{rows}

לא עוברות אחוז חסימה:
{below}

סה"כ מנדטים: {polls['total']}

voter2026.com עודכן אוטומטית ✅
"""
    
    msg = MIMEText(body, 'plain', 'utf-8')
    msg['Subject'] = f"✅ סקר עודכן — {polls['date']}"
    msg['From'] = EMAIL_TO
    msg['To'] = EMAIL_TO
    
    # Using Gmail SMTP (requires app password in env)
    smtp_pass = os.environ.get("GMAIL_APP_PASSWORD", "")
    if smtp_pass:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as s:
            s.login(EMAIL_TO, smtp_pass)
            s.send_message(msg)
        print("Email sent")
    else:
        print("No GMAIL_APP_PASSWORD set — skipping email")
        print(body)

def run():
    print(f"[{datetime.now()}] Starting poll update...")
    
    print("Fetching latest polls...")
    polls = fetch_polls()
    
    if not polls:
        print("ERROR: Could not fetch poll data")
        return
    
    print(f"Got data: {polls['total']} mandates, {len(polls['parties'])} parties")
    
    print("Fetching current HTML from GitHub...")
    html, sha = get_current_file()
    
    print("Updating phoneBars...")
    html = update_phonebars(html, polls)
    html = update_date_header(html, polls["date"])
    
    print("Pushing to GitHub...")
    success = push_to_github(html, sha, f"Auto-update polls — {polls['date']}")
    
    if success:
        print("✅ GitHub updated successfully")
        send_email(polls)
    else:
        print("❌ GitHub push failed")

if __name__ == "__main__":
    run()
