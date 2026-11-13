# REVIEW — THE FORGE (36 s)

## Creative calls
- Built storyline A (THE FORGE): result-first, one continuous camera logic — pull-back, rebuild-in-place, punch-in, slow orbit — so the viewer watches a product being made, which is the claim. Not built: B (Before/After, warmer split-screen) and C (Type as Cinema, beat-cut kinetic type for a 15 s cutdown). Both are saved in STORYLINES.md.
- The proof product is Pulse, this workspace's real app (a pharmacy that never sleeps), rebuilt as faithful HTML surfaces at video scale — terminal, editor, browser chrome — never a dimmed screenshot.
- One accent (#FF5A1F molten), rationed to one word per title shot, the live chart, and the forged end-card mark. Titles land dead still; the mark is forged from a line of code, never docked.

## Measured vs looked at
- Measured: `hyperframes check` — ok, 0 lint errors (9 files), 0 layout issues, contrast 78/78. Camera moves verified with `keyframes` (#s1-cam pull-back 1.06→1.00 over 3 s; #s6-punch 1→1.12→1).
- Looked at: beat sheet (16 frames), seam strip at the 3 s cut, phone sheet at 360 px, and full-res frames at 0.3 s and 35.75 s. Pictures alone tell the story in order; every headline reads at phone width.
- Nobody heard the sound: the film is silent in this offline run (no HeyGen sign-in, no local music model). The cut is timed to a 120 BPM grid so a licensed bed lands on the bar lines; SFX hits belong on the S6 click (f≈23.0 s abs) and the payoff downbeat (25 s).

## Fixes made in review
- t=0.3 s · S1 · first frame read empty → chart draw and order rows moved to 0.08–0.5 s; frame 0 now opens on a living dashboard.
- t=3.0 s seam · S2/S4/S5/S6 · entrances started near-black → kickers/headlines tightened to 0.04–0.16 s.
- S3 subline 24 px / short hold → 28 px, entered at 1.05 s.
- S1 chart tip overflowed its SVG by 8 px → moved inside; S5 line numbers/comments brightened → contrast 76/78 → 78/78.

## Warnings kept on purpose
- `text_below_floor` on UI micro-type (nav, pills, axis labels at 18–26 px): texture inside product surfaces shown at ~1.6×, not lines the viewer must read; every primary line is 50–150 px and passes at 360 px.
- `line_unread` on grouped UI blocks (cards, log lines): the checker measures the block as one line; each block persists inside its scene and its headline word carries the read.
- `film_silent`: deliberate offline delivery, see above.

## Weakest shot
S2 (the old way) is the most conventional frame — a headline over six tabs. It earns its place as the churn the wipe erases, but with more time I would give the tabs individual failures (a spinner, a red CI row sliding) instead of a shared judder.

## Housekeeping note
The system disk filled (ENOSPC) mid-run; the regenerable Next.js build cache at `pulse/.next` (435 MB) was removed to recover — rebuild with `npm run build`. Renders should relocate the frames cache if the disk is still near full.
