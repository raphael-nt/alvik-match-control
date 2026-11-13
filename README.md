# Alvik Match Control

Match control for the Arduino Alvik Smart Logistics Challenge (9 teams). Three web pages share live data through Supabase Realtime. One field, one match at a time, one central clock.

Live at https://raphael-nt.github.io/alvik-match-control/

| Page | Path | Used by |
|---|---|---|
| Admin | `/admin/` | Organizer. Calls matches, sets the schedule, edits the event log, manages teams |
| Dashboard | `/dashboard/` | Big screen. Central clock with 3 2 1 countdown, current match, bracket (`/tv/` redirects here) |
| Referee | `/ref/` | One phone or iPad. Runs the clock and records each judging criterion |

## First run

1. Open `/admin/` before sharing any links. Set the admin password (6+ characters) and the referee PIN (4 to 8 digits). This can only be done once.
2. Teams tab: set the format (groups, teams per group, how many advance, Bo for groups, knockout and final) and press Apply format. Groups play round robin, then a knockout bracket to the final. Then enter team names. Use Shuffle to draw groups, then Start draw to reveal names on the Dashboard.
3. Settings tab: setup time, game time, countdown seconds, and QR codes for each page.
4. Schedule tab: set the first match time and interval, press Auto fill, check, then Save schedule.

## Match day

- Admin presses **Call next match** in the Queue tab, or the system calls it at the scheduled time when the field is free.
- Referee signs in with the PIN, picks or randomizes the field pattern, starts setup, ticks the pre-start checklist, then presses **Start**. All screens count 3 2 1 together.
- During the game the referee presses the color of the side that did it first, once per criterion:
  1. Left red box first (rule 5.3)
  2. First lift (rule 5.1)
  3. Stands parked now, counter 0 to 3 per side (rule 5.4)
  4. Mission complete, hold to stop the clock immediately (rule 6.1, FAQ 33)
- Same time, Retry, Undo and False start are available. Taps are saved on the phone first and resent until the server accepts them.
- Review shows the result by rule 6. A full tie becomes a replay with the same pattern (FAQ 34). If no robot left the red box, the referee decides (FAQ 35).
- Admin can fix anything afterwards in the event log of each game. Results and standings are recomputed.

## Format

| Round | Group | Teams | Advance |
|---|---|---|---|
| Round 1 | A B C | 3 teams each (seeds 1-3, 4-6, 7-9) | 1st and 2nd |
| Round 2 | D | 1st A, 1st C, 2nd B | 1st to final |
| Round 2 | E | 1st B, 2nd A, 2nd C | 1st to final |
| Final | F | 1st D vs 1st E | Bo5 |

The table above is the default 9 team layout. Any format set in the Teams tab replaces it.

Round robin, every match Bo3, 16 matches in total. Ranking: matches won, game difference, games won, head to head, then referee decision. Final ranking: 1 champion, 2 runner-up, 3= 2nd of D and E, 5= 3rd of D and E, 7= 3rd of A, B and C.

## Technical notes

- Plain HTML and JavaScript ES modules, no build step, served from GitHub Pages.
- Supabase tables start with `a2_`. Every write goes through a SECURITY DEFINER RPC that checks the admin password or the referee PIN, device and session. Anonymous users can only read.
- SQL is in `supabase/migrations/` (001 to 009). `supabase/tests/008_v3_test.sql` tests the v3 logic inside a transaction that rolls back.
- Design: `docs/DESIGN_v3.md` (current) and `docs/DESIGN.md` (v2 and how it was built).
- `index.html` at the root links to the three pages. The old v1 system lives in `/legacy/`.
