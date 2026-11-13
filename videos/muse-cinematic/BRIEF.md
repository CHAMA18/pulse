# BRIEF — Muse Cinematic

workflow: general-video
flow: automation
storyboard: no

## Subject
Muse Code (muse-wonder-1.0) — the agentic coding CLI. This film is itself the proof: an advertisement of the quality of work Muse can do, built in HyperFrames so the viewer watches an idea become a shipped product.

## One thing
You describe it. Muse builds it — designed, coded, tested, shipped — in one continuous act of making.

## Viewer
A founder / product lead watching on a feed or landing page, sound off first, who must get the pitch from pictures and titles alone in 36 seconds.

## Output
- 1920×1080, 30 fps, 36 s (1080 frames)
- No voiceover. Large titles + product text carry the words.
- Music: designed to a 120 BPM grid (15 f/beat, 60 f/bar) so a licensed bed can be dropped on the bar lines. Delivered silent in this offline run — no HeyGen sign-in, no local MusicGen — with SFX hits placed on picture cuts in the edit notes. Add music via `npx hyperframes media-use resolve --type bgm` after `npx hyperframes auth login`.

## Must-haves
- Frame 0 is never black and never a logo alone — it opens on the finished product, alive.
- Every product surface is built as faithful HTML (terminal, editor, browser chrome) at video scale, never a dimmed screenshot with a title over it.
- One accent, rationed. One hero move per shot. Titles land dead still.
- End card: mark carried in, wordmark wipes in, CTA held 2.5 s.

## Constraints
- Offline registry (raw.githubusercontent.com unreachable) — no catalog blocks; all looks hand-authored after catalog search returned no fit.
- Disk: 0.8 GB free on the system volume — renders use the frames-cache relocation if needed.
- Not signed in to HeyGen — no catalog music, no generated voice/avatar.
