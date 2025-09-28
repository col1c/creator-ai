# backend/app/billing.py
from fastapi import APIRouter, Depends, HTTPException, Request
from .config import STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM, STRIPE_WEBHOOK_SECRET, FRONTEND_BASE_URL
from .supa import get_profile_sync, update_sync
import stripe

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

def _price_to_plan(price_id: str) -> str:
    if not price_id:
        return "pro"
    if STRIPE_PRICE_TEAM and price_id == STRIPE_PRICE_TEAM:
        return "team"
    if STRIPE_PRICE_PRO and price_id == STRIPE_PRICE_PRO:
        return "pro"
    return "pro"

@router.get("/plans")
def plans():
    return {
        "free": {"price": 0, "label":"Free", "limit": 50},
        "pro": {"price_id": STRIPE_PRICE_PRO, "label":"Pro", "euros": 9.99},
        "team": {"price_id": STRIPE_PRICE_TEAM, "label":"Team", "euros": 19.99} if STRIPE_PRICE_TEAM else None,
        "enabled": bool(STRIPE_SECRET_KEY and STRIPE_PRICE_PRO)
    }

@router.post("/create-checkout-session")
def create_checkout_session(payload: dict, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    if not STRIPE_SECRET_KEY or not STRIPE_PRICE_PRO:
        raise HTTPException(400, "billing disabled")

    price_id = payload.get("price_id") or STRIPE_PRICE_PRO

    customer = user.get("stripe_customer_id")
    if not customer:
        c = stripe.Customer.create(
            metadata={"user_id": str(user["user_id"])},
            email=user.get("email"),
        )
        customer = c["id"]
        update_sync("/rest/v1/users_public", {"stripe_customer_id": customer}, eq={"user_id": user["user_id"]})

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_BASE_URL}/billing?status=success",
        cancel_url=f"{FRONTEND_BASE_URL}/billing?status=cancel",
        customer=customer,
        metadata={"user_id": str(user["user_id"]), "plan": _price_to_plan(price_id)},
        allow_promotion_codes=True,
    )
    return {"url": session.url}

@router.post("/portal")
def create_billing_portal(user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    if not STRIPE_SECRET_KEY: raise HTTPException(400, "billing disabled")
    if not user.get("stripe_customer_id"): raise HTTPException(400, "no customer")
    portal = stripe.billing_portal.Session.create(
        customer=user["stripe_customer_id"],
        return_url=f"{FRONTEND_BASE_URL}/billing"
    )
    return {"url": portal.url}

@router.post("/webhook")
async def webhook(req: Request):
    if not STRIPE_WEBHOOK_SECRET:
        return {"ok": True, "dev": True}
    payload = (await req.body()).decode("utf-8")
    sig = req.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "invalid signature")

    typ = event["type"]
    data = event["data"]["object"]

    def update_plan_by_customer(customer_id: str, plan: str, sub_id: str | None, status: str | None):
        update_sync("/rest/v1/users_public", {
            "plan": plan,
            "stripe_subscription_id": sub_id,
            "stripe_status": (status or "").lower()
        }, eq={"stripe_customer_id": customer_id})

    if typ in ("checkout.session.completed",):
        customer_id = data.get("customer")
        price_id = None
        # get price id from line items if available
        try:
            items = data.get("display_items") or data.get("line_items", {}).get("data") or []
            if items:
                price_id = (items[0].get("price") or items[0].get("plan",{})).get("id")
        except Exception:
            price_id = None
        plan = _price_to_plan(price_id)
        update_plan_by_customer(customer_id, plan, data.get("subscription"), data.get("status"))

    elif typ in ("customer.subscription.created","customer.subscription.updated"):
        customer_id = data.get("customer")
        status = data.get("status")
        items = data.get("items", {}).get("data", [])
        price_id = items[0]["price"]["id"] if items else None
        plan = _price_to_plan(price_id)
        update_plan_by_customer(customer_id, plan, data.get("id"), status)

    elif typ in ("customer.subscription.deleted","invoice.payment_failed"):
        customer_id = data.get("customer")
        update_sync("/rest/v1/users_public", {
            "plan": "free",
            "stripe_status": "canceled",
            "pro_until": None
        }, eq={"stripe_customer_id": customer_id})

    return {"ok": True}
