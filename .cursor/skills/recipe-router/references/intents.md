# Intent boundaries

- `丝瓜鸡蛋汤怎么做` → `dish`, query `丝瓜鸡蛋汤`.
- `我有丝瓜和鸡蛋` → `ingredients`, tokens `丝瓜`, `鸡蛋`.
- `用鲍鱼海参做佛跳墙` → `dish` because the named dish controls identity.
- If the request is ambiguous, prefer dish mode only when a known dish name is present.
