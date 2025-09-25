import httpx
from .config import settings

def send_mail(to: str, subject: str, text: str):
    if not (settings.MAILGUN_API_KEY and settings.MAILGUN_DOMAIN):
        raise RuntimeError("Mailgun nicht konfiguriert")
    url = f"https://api.mailgun.net/v3/{settings.MAILGUN_DOMAIN}/messages"
    auth = ("api", settings.MAILGUN_API_KEY)
    data = {
        "from": settings.MAIL_FROM,
        "to": [to],
        "subject": subject,
        "text": text,
    }
    with httpx.Client(timeout=15.0) as c:
        r = c.post(url, auth=auth, data=data)
        r.raise_for_status()
