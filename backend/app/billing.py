# billing.py
from fastapi import APIRouter, Depends, HTTPException, Request
from .config import (
    STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM,
    STRIPE_WEBHOOK_SECRET, FRONTEND_BASE_URL
)
from .supa import get_profile_sync, update_sync

try:
    import stripe  # type: ignore
except Exception:  # ImportError oder Typing-Probleme
    stripe = None  # fallback für Dev

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

if stripe and STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

def billing_enabled() -> bool:
    return bool(stripe and STRIPE_SECRET_KEY and STRIPE_PRICE_PRO)

@router.get("/plans")
def plans():
    return {
        "free": {"price": 0, "label": "Free", "limit": 50},
        "pro": {"price_id": STRIPE_PRICE_PRO, "label": "Pro", "euros": 9.99},
        "team": {"price_id": STRIPE_PRICE_TEAM, "label": "Team", "euros": 19.99},
        "enabled": billing_enabled(),
    }

@router.post("/create-checkout-session")
def create_checkout_session(payload: dict, user=Depends(get_profile_sync)):
    if not user:
        raise HTTPException(401, "auth")
    if not billing_enabled():
        raise HTTPException(400, "billing disabled")

    price_id = payload.get("price_id") or STRIPE_PRICE_PRO

    customer = None
    if user.get("stripe_customer_id"):
        customer = user["stripe_customer_id"]
    else:
        c = stripe.Customer.create(  # type: ignore[attr-defined]
            metadata={"user_id": str(user["user_id"])},
            email=user.get("email"),
        )
        customer = c["id"]
        update_sync("/rest/v1/users_public", {"stripe_customer_id": customer},
                    eq={"user_id": user["user_id"]})

    session = stripe.checkout.Session.create(  # type: ignore[attr-defined]
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_BASE_URL}/billing?status=success",
        cancel_url=f"{FRONTEND_BASE_URL}/billing?status=cancel",
        customer=customer,
        metadata={"user_id": str(user["user_id"])},
        allow_promotion_codes=True,
    )
    return {"url": session.url}

@router.get("/customer-portal")
def customer_portal(user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    if not STRIPE_SECRET_KEY:
        raise HTTPException(400, "billing disabled")
    if not user.get("stripe_customer_id"):
        raise HTTPException(400, "no customer")
    session = stripe.billing_portal.Session.create(
        customer=user["stripe_customer_id"],
        return_url=f"{FRONTEND_BASE_URL}/billing"
    )
    return {"url": session.url}

@router.post("/webhook")
async def webhook(req: Request):
    if not STRIPE_WEBHOOK_SECRET:
        return {"ok": True, "dev": True}
    if not stripe:
        raise HTTPException(503, "stripe unavailable")

    payload_bytes = await req.body()
    payload = payload_bytes.decode("utf-8") if isinstance(payload_bytes, (bytes, bytearray)) else str(payload_bytes)
    sig = req.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(  # type: ignore[attr-defined]
            payload, sig, STRIPE_WEBHOOK_SECRET
        )
    except Exception:
        raise HTTPException(400, "invalid signature")

    typ = event["type"]
    data = event["data"]["object"]

    if typ in ("checkout.session.completed",
               "customer.subscription.created",
               "customer.subscription.updated"):
        customer_id = data.get("customer") or data.get("customer_id")
        sub_id = data.get("id") if "subscription" not in data else data["subscription"]
        status = (data.get("status") or "").lower()
        update_sync("/rest/v1/users_public", {
            "plan": "pro",
            "stripe_subscription_id": sub_id,
            "stripe_status": status,
        }, eq={"stripe_customer_id": customer_id})
    elif typ in ("customer.subscription.deleted", "invoice.payment_failed"):
        customer_id = data.get("customer")
        update_sync("/rest/v1/users_public", {
            "plan": "free",
            "stripe_status": "canceled",
            "pro_until": None
        }, eq={"stripe_customer_id": customer_id})

    return {"ok": True}
