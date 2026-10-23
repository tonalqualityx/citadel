#!/usr/bin/env python3
"""Fleet item 3 HTTP race: two claim requests for one task fired behind a Barrier, N rounds, one task per round.
Exactly one 200 and one 409 (claim_taken, naming the winner) each round. Stdlib only.
Usage: CLAIMS_RACE_BASE=http://127.0.0.1:PORT CLAIMS_RACE_KEY=<api key> CLAIMS_RACE_TASKS=id1,id2,... claims-http-race.py
The key is read from the environment inside this program and never printed."""
import json
import os
import sys
import threading
from urllib import error, request

base = os.environ["CLAIMS_RACE_BASE"]
key = os.environ["CLAIMS_RACE_KEY"]
tasks = [t for t in os.environ["CLAIMS_RACE_TASKS"].split(",") if t]


def fire(task, holder, out, idx, barrier):
    req = request.Request(
        f"{base}/api/tasks/{task}/claim",
        data=json.dumps({"holder": holder}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    barrier.wait()
    try:
        with request.urlopen(req, timeout=30) as r:
            out[idx] = (r.status, json.loads(r.read()))
    except error.HTTPError as e:
        out[idx] = (e.code, json.loads(e.read() or b"{}"))


bad = []
for n, task in enumerate(tasks):
    barrier = threading.Barrier(2)
    out = [None, None]
    th = [threading.Thread(target=fire, args=(task, h, out, i, barrier)) for i, h in enumerate(("holder-A", "holder-B"))]
    [t.start() for t in th]
    [t.join() for t in th]
    codes = sorted(o[0] for o in out)
    if codes != [200, 409]:
        bad.append(f"round {n}: codes {codes}")
        continue
    win = next(o for o in out if o[0] == 200)[1]["holder"]
    lose = next(o for o in out if o[0] == 409)[1]
    if lose.get("code") != "claim_taken" or lose.get("holder") != win:
        bad.append(f"round {n}: loser body {lose}, winner {win}")
print(f"rounds={len(tasks)} bad={len(bad)}")
for b in bad[:10]:
    print(b)
sys.exit(1 if bad else 0)
