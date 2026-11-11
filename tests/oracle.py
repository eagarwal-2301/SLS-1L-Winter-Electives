#!/usr/bin/env python3
"""Independent check of the site's scheduling logic and .ics output.

Re-derives everything from courses.json in Python (separate code, separate
date library) and compares against what the JavaScript produced.

Usage (from the project root):
  JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
  $JSC -m tests/logic.mjs > /tmp/logic.json
  python3 tests/oracle.py /tmp/logic.json            # checks logic.json
  python3 tests/oracle.py --ics some-download.ics    # checks a downloaded file
"""
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "courses.json").read_text())
LA = ZoneInfo("America/Los_Angeles")
UTC = ZoneInfo("UTC")
WD = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4}
NO_CLASS = {d["date"] for d in DATA["meta"]["calendar"]["noClassDates"]}
ALL = DATA["required"] + DATA["electives"]
BY_TITLE = {c["title"]: c for c in ALL}

failures = []


def fail(msg):
    failures.append(msg)


def expand(m):
    """All class dates for one meeting (inclusive range, weekday match, minus holidays)."""
    d = date.fromisoformat(m["startDate"])
    end = date.fromisoformat(m["endDate"])
    out = []
    while d <= end:
        if d.weekday() == WD[m["day"]] and d.isoformat() not in NO_CLASS:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def occurrences(course):
    """set of (date, start, end) for a course."""
    return {(d, m["start"], m["end"]) for m in course["meetings"] for d in expand(m)}


def mins(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def expected_conflicts():
    out = {}
    occ = {c["id"]: occurrences(c) for c in ALL}
    for i, a in enumerate(ALL):
        for b in ALL[i + 1:]:
            hits = set()
            for (d1, s1, e1) in occ[a["id"]]:
                for (d2, s2, e2) in occ[b["id"]]:
                    if d1 == d2 and mins(s1) < mins(e2) and mins(s2) < mins(e1):
                        hits.add(d1)
            if hits:
                out[tuple(sorted((a["id"], b["id"])))] = sorted(hits)
    return out


# ---------------- .ics parsing ----------------

def unfold(text):
    if "\r\n" not in text:
        fail("ics: lines are not CRLF-terminated")
    raw = text.split("\r\n")
    for i, line in enumerate(raw):
        if len(line.encode("utf-8")) > 75:
            fail(f"ics: physical line {i + 1} is longer than 75 octets")
        if "\n" in line or "\r" in line:
            fail(f"ics: bare newline in line {i + 1}")
    lines = []
    for line in raw:
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        elif line:
            lines.append(line)
    return lines


def parse_prop(line):
    name_params, value = line.split(":", 1)
    parts = name_params.split(";")
    params = dict(p.split("=", 1) for p in parts[1:])
    return parts[0], params, value


def parse_local(value, params):
    if params.get("TZID") != "America/Los_Angeles":
        fail(f"ics: expected TZID=America/Los_Angeles, got {params}")
    return datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=LA)


def unescape(v):
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), v)


def ics_occurrences(text):
    """dict title -> set of (date, start, end) from an .ics file."""
    lines = unfold(text)
    if lines[0] != "BEGIN:VCALENDAR" or lines[-1] != "END:VCALENDAR":
        fail("ics: not wrapped in VCALENDAR")
    if "VERSION:2.0" not in lines:
        fail("ics: missing VERSION:2.0")
    if "BEGIN:VTIMEZONE" not in lines or "TZID:America/Los_Angeles" not in lines:
        fail("ics: missing VTIMEZONE for America/Los_Angeles")
    events, cur = [], None
    for line in lines:
        if line == "BEGIN:VEVENT":
            cur = {"EXDATE": []}
        elif line == "END:VEVENT":
            events.append(cur)
            cur = None
        elif cur is not None:
            name, params, value = parse_prop(line)
            if name == "EXDATE":
                cur["EXDATE"].append(parse_local(value, params))
            else:
                cur[name] = (params, value)
    uids = [e["UID"][1] for e in events]
    if len(uids) != len(set(uids)):
        fail("ics: duplicate UIDs")
    out = {}
    for e in events:
        for req in ("UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY"):
            if req not in e:
                fail(f"ics: event missing {req}")
        title = unescape(e["SUMMARY"][1])
        start = parse_local(e["DTSTART"][1], e["DTSTART"][0])
        end = parse_local(e["DTEND"][1], e["DTEND"][0])
        dur = end - start
        starts = [start]
        if "RRULE" in e:
            rule = dict(p.split("=") for p in e["RRULE"][1].split(";"))
            if rule.get("FREQ") != "WEEKLY":
                fail(f"ics: unexpected RRULE {rule}")
            until_s = rule["UNTIL"]
            if not until_s.endswith("Z"):
                fail("ics: UNTIL must be UTC when DTSTART has a TZID")
            until = datetime.strptime(until_s, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            byday = rule.get("BYDAY")
            if byday and byday[:2] != ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][start.weekday()]:
                fail(f"ics: BYDAY {byday} does not match DTSTART weekday for {title}")
            nxt = start
            starts = []
            while nxt <= until:
                starts.append(nxt)
                # wall-clock weekly recurrence in local time
                nxt = (nxt.replace(tzinfo=None) + timedelta(days=7)).replace(tzinfo=LA)
        ex = set(e["EXDATE"])
        for s in starts:
            if s in ex:
                continue
            en = s + dur
            out.setdefault(title, set()).add((s.date().isoformat(), s.strftime("%H:%M"), en.strftime("%H:%M")))
        for x in ex:
            if x not in starts:
                fail(f"ics: EXDATE {x} for {title} does not match any occurrence")
    return out


def check_ics(text, expect_titles=None):
    got = ics_occurrences(text)
    for title, occ in got.items():
        c = BY_TITLE.get(title)
        if not c:
            fail(f"ics: unknown event title {title!r}")
            continue
        exp = occurrences(c)
        if occ != exp:
            fail(f"ics: {title}: missing {sorted(exp - occ)[:4]} extra {sorted(occ - exp)[:4]}")
    if expect_titles is not None:
        missing = set(expect_titles) - set(got)
        extra = set(got) - set(expect_titles)
        if missing:
            fail(f"ics: missing courses {sorted(missing)}")
        if extra:
            fail(f"ics: unexpected courses {sorted(extra)}")
    return got


def main():
    args = sys.argv[1:]
    if args[:1] == ["--ics"]:
        got = check_ics(Path(args[1]).read_text(encoding="utf-8"))
        n = sum(len(v) for v in got.values())
        print(f"ics file: {len(got)} courses, {n} class meetings")
        for t in sorted(got):
            print(f"  {t}: {len(got[t])}")
    else:
        out = json.loads(Path(args[0]).read_text())
        for f in out["failures"]:
            fail("js: " + f)
        print(f"unit combinations checked: {out['combos']:,}")

        # meeting date expansion
        for c in ALL:
            js = out["dates"][c["id"]]
            for m, jm in zip(c["meetings"], js):
                if expand(m) != jm["dates"]:
                    fail(f"dates: {c['id']} {m['day']} {m['startDate']}..{m['endDate']}: js={jm['dates']} py={expand(m)}")

        # conflicts
        exp = expected_conflicts()
        got = {}
        for p in out["conflicts"]:
            key = tuple(sorted((p["a"], p["b"])))
            got[key] = sorted({d for o in p["overlaps"] for d in o["dates"]})
        if set(exp) != set(got):
            fail(f"conflicts: missing {sorted(set(exp) - set(got))[:5]} extra {sorted(set(got) - set(exp))[:5]}")
        for k in exp:
            if k in got and exp[k] != got[k]:
                fail(f"conflicts: {k} dates js={got[k]} py={exp[k]}")
        req_ids = {c["id"] for c in DATA["required"]}
        req_conf = [k for k in exp if req_ids & set(k)]
        print(f"conflicting pairs: {len(exp)} (of {len(ALL) * (len(ALL) - 1) // 2} pairs; {len(req_conf)} involve a required course)")
        partial_pairs = {k: v for k, v in exp.items() if any(
            any(m["startDate"] > DATA["meta"]["calendar"]["firstDay"] or m["endDate"] < DATA["meta"]["calendar"]["lastDay"] for m in BY_ID[i]["meetings"]) for i in k)}
        print(f"  of which involve a partial-quarter course: {len(partial_pairs)}")
        for k, v in sorted(partial_pairs.items()):
            print(f"    {k[0]} × {k[1]}: {len(v)} shared date(s)")

        # ics
        got_all = check_ics(out["ics"], expect_titles=[c["title"] for c in ALL])
        print(f"ics (all courses): {len(got_all)} courses, {sum(len(v) for v in got_all.values())} class meetings")
        got_p = check_ics(out["icsPicks"], expect_titles=[c["title"] for c in DATA["required"]] + [c["title"] for c in DATA["electives"] if c["title"].startswith(("Fintech", "Business Leadership"))])
        print("ics (required + Fintech + Business Leadership):")
        for t in sorted(got_p):
            ds = sorted(got_p[t])
            print(f"  {t}: {len(ds)} meetings, {ds[0][0]} .. {ds[-1][0]}")

        # targeted calendar facts
        mon = [c for c in ALL if any(m["day"] == "Mon" for m in c["meetings"])]
        for c in mon:
            occ = got_all[c["title"]]
            if any(d == "2027-01-18" for d, _, _ in occ):
                fail(f"{c['title']} meets on MLK Day")
            if not any(d == "2027-02-15" for d, _, _ in occ):
                fail(f"{c['title']} is missing Presidents' Day (Monday classes meet)")
        fin = got_all[next(t for t in got_all if t.startswith("Fintech"))]
        if max(d for d, _, _ in fin) != "2027-02-11":
            fail("Fintech should end Feb 11")

    if failures:
        print(f"\nFAILED ({len(failures)}):")
        for f in failures[:40]:
            print("  -", f)
        sys.exit(1)
    print("\nALL CHECKS PASSED")


BY_ID = {c["id"]: c for c in ALL}

if __name__ == "__main__":
    main()
