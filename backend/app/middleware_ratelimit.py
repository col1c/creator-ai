# NEU: einfache globale Rate-Limit Middleware (pro User-ID/IP)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from time import monotonic
from collections import defaultdict, deque
from typing import Deque, Tuple

class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, per_sec=2, per_min=60):
        super().__init__(app)
        self.per_sec = per_sec
        self.per_min = per_min
        self.hits_sec: dict[str, Deque[float]] = defaultdict(deque)
        self.hits_min: dict[str, Deque[float]] = defaultdict(deque)

    async def dispatch(self, request, call_next):
        path = request.url.path
        # Health/Webhooks/Cron ggf. ausnehmen
        if path.endswith("/health") or path.endswith("/webhooks/stripe"):
            return await call_next(request)

        ident = "anon"
        # User-ID aus Bearer (wird in main ohnehin verifiziert – hier nur zur Key-Bildung)
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            ident = auth[-20:]  # anonymisiert
        else:
            # Fallback IP
            ident = request.client.host if request.client else "anon"

        now = monotonic()
        dq1 = self.hits_sec[ident]
        dq2 = self.hits_min[ident]

        # cleanup
        while dq1 and now - dq1[0] > 1.0: dq1.popleft()
        while dq2 and now - dq2[0] > 60.0: dq2.popleft()

        if len(dq1) >= self.per_sec or len(dq2) >= self.per_min:
            return JSONResponse({"detail":"Rate limit exceeded"}, status_code=429)

        dq1.append(now); dq2.append(now)
        return await call_next(request)
