"""Project-level service and ingress projections for the Console."""

import datetime
import json
import math
import re
import subprocess
import time

TAIL_BYTES = 256 * 1024
TAIL_RECORDS = 1000
ENTRY_LIMIT = 50


def safe_path(value):
    if not isinstance(value, str) or not value.startswith("/"):
        return None
    if len(value) > 160 or not re.fullmatch(r"/[A-Za-z0-9._~:/-]*", value, re.ASCII):
        return None
    return "/".join(segment if len(segment) <= 40 else ":redacted" for segment in value.split("/"))


def safe_id(value, pattern):
    return value if isinstance(value, str) and re.fullmatch(pattern, value, re.ASCII) else None


def service_metrics(slot):
    keys = {
        "ActiveState": "activeState",
        "SubState": "subState",
        "NRestarts": "restarts",
        "MemoryCurrent": "memoryBytes",
        "CPUUsageNSec": "cpuUsageNanoseconds",
    }
    metrics = dict.fromkeys(keys.values())
    try:
        response = subprocess.run(
            [
                "/usr/bin/systemctl",
                "show",
                *[f"--property={key}" for key in keys],
                f"arsvine-web-{slot}.service",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return metrics
    for line in response.stdout.splitlines():
        key, _, value = line.partition("=")
        if key not in keys:
            continue
        if key in ("ActiveState", "SubState"):
            metrics[keys[key]] = value
        elif value.isascii() and value.isdecimal() and int(value) < 2**53:
            metrics[keys[key]] = int(value)
    return metrics


def ingress(path):
    result = {
        "requests": 0,
        "errors5xx": 0,
        "p95Milliseconds": None,
        "since": None,
        "entries": [],
    }
    try:
        with path.open("rb") as log:
            start = max(0, log.seek(0, 2) - TAIL_BYTES)
            log.seek(start)
            records = log.read(TAIL_BYTES).splitlines()[1 if start else 0 :]
    except OSError:
        return result
    entries = []
    cutoff = time.time() - 3600
    for line in records[-TAIL_RECORDS:]:
        try:
            entry = json.loads(line)
            ts, status, duration, size = (
                entry[key] for key in ("ts", "status", "duration", "size")
            )
            if (
                type(ts) not in (int, float)
                or not cutoff <= ts <= time.time() + 60
                or type(status) is not int
                or not 100 <= status <= 599
                or type(duration) not in (int, float)
                or not 0 <= duration <= 3600
                or type(size) is not int
                or size < 0
            ):
                continue
            entries.append(
                {
                    "at": datetime.datetime.fromtimestamp(ts, tz=datetime.UTC).isoformat(
                        timespec="seconds"
                    ),
                    "status": status,
                    "durationMs": round(duration * 1000, 2),
                    "bytes": size,
                    "path": safe_path(entry.get("path")),
                    "requestId": safe_id(entry.get("request_id"), r"[A-Za-z0-9._:-]{1,64}"),
                    "cfRay": safe_id(entry.get("cf_ray"), r"[a-f0-9]{16}-[A-Z]{3}"),
                }
            )
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    if entries:
        n = len(entries)
        elapsed = sorted(entry["durationMs"] for entry in entries)
        result = {
            "requests": n,
            "errors5xx": sum(entry["status"] >= 500 for entry in entries),
            "p95Milliseconds": elapsed[math.ceil(0.95 * n) - 1],
            "since": entries[0]["at"],
            "entries": list(reversed(entries[-ENTRY_LIMIT:])),
        }
    return result
