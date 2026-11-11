# SLS 1L Winter 2027 Electives

Unofficial one-page planner for 1Ls: a weekly calendar with the required
courses, a searchable list of Winter 2027 electives to add to it, details for
the ones you pick, and a calendar (.ics) export.
Static site: plain HTML/CSS/JS, no build step, no backend, no tracking.

## Fixing a course

All course information lives in **`courses.json`**. Edit it and redeploy; no
code changes needed. If an edit breaks something (bad time format, missing
field, duplicate id), the page shows a red box listing the problem instead of
failing silently.

Formats the site relies on:

| Field | Format |
|---|---|
| `meetings[].day` | `Mon` … `Fri` |
| `meetings[].start` / `end` | 24-hour `HH:MM` (Pacific) |
| `meetings[].startDate` / `endDate` | `YYYY-MM-DD`; the meeting repeats weekly on `day` within this range |
| one-off dates | one meeting with `startDate` = `endDate` (see Business Leadership) |
| `enrollment.deadline` / `opens`, `meta.deadlines[].date` | `YYYY-MM-DDTHH:MM` (Pacific) |
| `enrollment.seats` | number, or `null` for no cap |
| `meta.calendar.noClassDates` | skipped in the schedule, conflicts and .ics |

## Preview locally

```sh
cd ~/Desktop/Vibe-coding/sls-electives
python3 -m http.server 8765
# open http://localhost:8765  (tests: http://localhost:8765/tests/)
```

## Tests

- `tests/index.html`: open in a browser (via the local server). Adds every
  elective and checks its table values against `courses.json`, plus keyword
  search, unit warnings, conflicts, hover preview, the deadline spotlight,
  persistence, and the no-scroll layout at 1440×900 / 1280×800 / 390×844.
- `tests/logic.mjs` + `tests/oracle.py`: command-line check, no Node needed:
  ```sh
  JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
  $JSC -m tests/logic.mjs > /tmp/logic.json && python3 tests/oracle.py /tmp/logic.json
  ```
  It checks every combination of up to 5 electives against the unit limits,
  checks all course pairs for conflicts against an independent Python version,
  and parses the generated .ics to confirm every class date.
- Check a real downloaded file: `python3 tests/oracle.py --ics ~/Downloads/sls-1l-winter-2027.ics`

`tests/` and this README are excluded from the deploy (`.vercelignore`).

## Deploy to Vercel

Vercel deploys from a GitHub repo. No build step, no Node needed.

1. **Make a GitHub repo.** On github.com: **New repository**, name it (e.g.
   `sls-1l-electives`), Private is fine, and leave every "Add …" box unchecked.
2. **Upload the site files.** On the new repo page, click **uploading an existing
   file**, then drag these in from `~/Desktop/Vibe-coding/sls-electives` in Finder and **Commit changes**:
   `index.html`, `courses.json`, `vercel.json`, `css/`, `js/`.
   (Leave out `tests/` and `README.md`; they aren't needed on the live site.)
3. **Import into Vercel.** On vercel.com, sign in with GitHub, then
   **Add New… → Project**, pick the repo (allow Vercel access to it if asked), and
   - Framework Preset: **Other**
   - Build Command / Output Directory: leave empty
   - Click **Deploy**.
4. Share the `https://<project>.vercel.app` link (the one under **Domains** on
   the project page). You can rename it under Settings → Domains.

**Fixing data later:** open `courses.json` on GitHub, click the pencil icon,
edit, **Commit changes**. Vercel redeploys within a minute, and `courses.json`
is served with `Cache-Control: no-cache`, so people get the fix on their next load.

`vercel.json` also sets a strict Content-Security-Policy. The page loads
nothing from other sites.
