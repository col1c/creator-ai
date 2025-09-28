# app/billing.py
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from .config import STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM, STRIPE_WEBHOOK_SECRET, FRONTEND_BASE_URL
from .supa import get_user_from_token, get_profile, _patch_sync, _post_sync, _get_sync
try:
    import stripe  # type: ignore
except Exception:
    stripe = None

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])
if stripe and STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

def require_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    uid = get_user_from_token(token).get("id")
    if not uid:
        raise HTTPException(401, "auth")
    prof = get_profile(uid) or {"user_id": uid}
    return prof

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
def create_checkout_session(payload: dict, user=Depends(require_user)):
    if not billing_enabled():
        raise HTTPException(400, "billing disabled")

    price_id = payload.get("price_id") or STRIPE_PRICE_PRO
    customer = user.get("stripe_customer_id")
    if not customer:
        c = stripe.Customer.create(  # type: ignore
            metadata={"user_id": str(user["user_id"])}, email=user.get("email")
        )
        customer = c["id"]
        _patch_sync("/rest/v1/users_public", params={"user_id": f"eq.{user['user_id']}"}, json={"stripe_customer_id": customer})

    session = stripe.checkout.Session.create(  # type: ignore
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_BASE_URL}/billing?status=success",
        cancel_url=f"{FRONTEND_BASE_URL}/billing?status=cancel",
        customer=customer,
        metadata={"user_id": str(user["user_id"])},
        allow_promotion_codes=True,
    )
    return {"url": session.url}

@router.post("/webhook")
async def webhook(req: Request):
    if not STRIPE_WEBHOOK_SECRET:
        return {"ok": True, "dev": True}
    if not stripe:
        raise HTTPException(503, "stripe unavailable")

    payload = await req.body()
    sig = req.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)  # type: ignore
    except Exception:
        raise HTTPException(400, "invalid signature")

    typ = event["type"]
    data = event["data"]["object"]

    if typ in ("checkout.session.completed", "customer.subscription.created", "customer.subscription.updated"):
        customer_id = data.get("customer") or data.get("customer_id")
        sub_id = data.get("id") if "subscription" not in data else data["subscription"]
        status = (data.get("status") or "").lower()
        _patch_sync("/rest/v1/users_public", params={"stripe_customer_id": f"eq.{customer_id}"}, json={
            "plan": "pro",
            "stripe_subscription_id": sub_id,
            "stripe_status": status,
        })
    elif typ in ("customer.subscription.deleted", "invoice.payment_failed"):
        customer_id = data.get("customer")
        _patch_sync("/rest/v1/users_public", params={"stripe_customer_id": f"eq.{customer_id}"}, json={
            "plan": "free",
            "stripe_status": "canceled",
            "pro_until": None,
        })
    return {"ok": True}
