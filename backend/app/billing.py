# backend/app/billing.py
from fastapi import APIRouter, HTTPException, Header, Request
from typing import Optional, Dict
import os, requests, stripe

# Konfig aus config.py (du hast die STRIPE_* dort bereits exportiert)
from .config import (
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_PRO,
    STRIPE_PRICE_TEAM,
    STRIPE_WEBHOOK_SECRET,
    FRONTEND_BASE_URL,
    settings,
)
from .supa import get_user_from_token, _get_sync

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

# Stripe initialisieren (falls konfiguriert)
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY


# ----------------- interne Helpers -----------------
def _sb_headers_sr() -> Dict[str, str]:
    sr = os.environ.get("SUPABASE_SERVICE_ROLE")
    if not sr:
        raise RuntimeError("SUPABASE_SERVICE_ROLE missing")
    return {"apikey": sr, "Authorization": f"Bearer {sr}"}

def _sb_base() -> str:
    base = os.environ.get("SUPABASE_URL")
    if not base:
        raise RuntimeError("SUPABASE_URL missing")
    return base.rstrip("/")

def _sb_patch(table: str, patch: dict, eq: Dict[str, str]) -> None:
    """
    PATCH /rest/v1/{table}?col=eq.value
    """
    base = _sb_base()
    params = {}
    for k, v in eq.items():
        params[k] = f"eq.{v}"
    headers = _sb_headers_sr()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=minimal"
    r = requests.patch(f"{base}/rest/v1/{table}", headers=headers, params=params, json=patch, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"supabase patch error {r.status_code}: {r.text}")

def _require_user_profile(authorization: Optional[str]) -> dict:
    """
    Liest den Supabase-User (JWT) und holt dazu das Profil aus users_public.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1].strip()
    user = get_user_from_token(token)
    if not user or not user.get("id"):
        raise HTTPException(401, "auth")
    uid = user["id"]

    rows, _ = _get_sync("/rest/v1/users_public", {
        "select": "user_id,email,stripe_customer_id,plan",
        "user_id": f"eq.{uid}",
    })
    prof = (rows or [{}])[0]
    prof["user_id"] = uid
    # E-Mail ggfs. vom Auth-User übernehmen (falls im Profil leer)
    if not prof.get("email"):
        prof["email"] = user.get("email")
    return prof
# ----------------------------------------------------


@router.get("/plans")
def plans():
    return {
        "free": {"price": 0, "label": "Free", "limit": 50},
        "pro": {"price_id": STRIPE_PRICE_PRO or "", "label": "Pro", "euros": 9.99},
        "team": {"price_id": STRIPE_PRICE_TEAM or "", "label": "Team", "euros": 19.99},
        "enabled": bool(STRIPE_SECRET_KEY and (STRIPE_PRICE_PRO or STRIPE_PRICE_TEAM)),
    }


@router.post("/create-checkout-session")
def create_checkout_session(payload: dict, authorization: Optional[str] = Header(None)):
    """
    Startet Stripe Checkout für Abo (Pro default). Erwartet Bearer-Token.
    """
    if not STRIPE_SECRET_KEY or not (STRIPE_PRICE_PRO or payload.get("price_id")):
        raise HTTPException(400, "billing disabled")

    user = _require_user_profile(authorization)
    uid = str(user["user_id"])
    email = user.get("email")

    price_id = payload.get("price_id") or STRIPE_PRICE_PRO

    # ensure customer
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        try:
            cust = stripe.Customer.create(
                email=email,
                metadata={"user_id": uid},
            )
            customer_id = cust["id"]
            _sb_patch("users_public", {"stripe_customer_id": customer_id}, {"user_id": uid})
        except Exception as e:
            raise HTTPException(500, f"stripe customer error: {str(e)}")

    success = os.getenv("FRONTEND_BASE_URL", FRONTEND_BASE_URL or "").rstrip("/") + "/billing?status=success"
    cancel = os.getenv("FRONTEND_BASE_URL", FRONTEND_BASE_URL or "").rstrip("/") + "/billing?status=cancel"
    if not success.startswith("http"):
        # Fallback (lokal)
        success = (settings.VERCEL_ORIGIN or "http://localhost:5173").rstrip("/") + "/billing?status=success"
        cancel  = (settings.VERCEL_ORIGIN or "http://localhost:5173").rstrip("/") + "/billing?status=cancel"

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success,
            cancel_url=cancel,
            customer=customer_id,
            metadata={"user_id": uid},
            allow_promotion_codes=True,
        )
    except Exception as e:
        raise HTTPException(500, f"stripe checkout error: {str(e)}")

    return {"url": session.url}


@router.post("/webhook")
async def webhook(req: Request):
    """
    Stripe Webhook: setzt Plan/Felder in users_public anhand Events.
    In Stripe das Endpoint-Secret STRIPE_WEBHOOK_SECRET eintragen.
    """
    if not STRIPE_WEBHOOK_SECRET:
        # Dev-Fallback: akzeptiere alles ohne Signaturprüfung
        event = await req.json()
    else:
        payload = await req.body()
        sig = req.headers.get("stripe-signature")
        try:
            event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        except Exception:
            raise HTTPException(400, "invalid signature")

    typ = event.get("type")
    data = event.get("data", {}).get("object", {})

    try:
        if typ in ("checkout.session.completed", "customer.subscription.created", "customer.subscription.updated"):
            customer_id = data.get("customer") or data.get("customer_id")
            # subscription id je nach Event-Struktur
            sub_id = data.get("subscription") or data.get("id")
            status = (data.get("status") or "").lower()

            if not customer_id:
                raise ValueError("no customer in event")

            # Planeinstellung: hier pauschal 'pro'. Optional: am Preis-Objekt unterscheiden.
            _sb_patch("users_public", {
                "plan": "pro",
                "stripe_subscription_id": sub_id,
                "stripe_status": status,
            }, {"stripe_customer_id": customer_id})

        elif typ in ("customer.subscription.deleted", "invoice.payment_failed"):
            customer_id = data.get("customer")
            if not customer_id:
                raise ValueError("no customer in event")
            _sb_patch("users_public", {
                "plan": "free",
                "stripe_status": "canceled",
                "pro_until": None,
            }, {"stripe_customer_id": customer_id})

    except Exception as e:
        # Loggen, aber 200 zurück (Stripe retried sonst endlos); alternativ 400 wenn du strict willst.
        return {"ok": False, "error": str(e), "ack": True}

    return {"ok": True}
