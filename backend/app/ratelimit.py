import os, time
from collections import deque, defaultdict
from typing import Tuple

WINDOW = 60  # Sekunden
LIMIT = int(os.getenv("RATE_LIMIT_PER_MIN", "60"))  # z.B. 60/min
_buckets = defaultdict(deque)

def check_allow(key: str) -> Tuple[bool, int, int]:
    now = time.time()
    q = _buckets[key]
    # alte Einträge entfernen
    while q and q[0] <= now - WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        return False, LIMIT, len(q)
    q.append(now)
    return True, LIMIT, len(q)
