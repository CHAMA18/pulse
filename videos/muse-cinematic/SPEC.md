GOAL:    The viewer feels that one sentence, given to Muse, becomes a designed, working, shipped product — and that this film is itself an example.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps
TIME:    36 s x 30 fps = 1080 frames; music grid 120 BPM = 15 frames/beat, 60 frames/bar (2 s/bar); cuts land on frame numbers divisible by 15
LOOK:    ground #0C0C0E matte charcoal, 2% film grain, 6% vignette, seamless-sweep falloff (radial, never a full-screen linear gradient);
         ink #F2EDE3 warm bone; muted #8A8578; hairline #2A2A2E at 2px;
         one accent #FF5A1F molten — allowed only on: one word per title shot, the live data line in the payoff, the end-card mark;
         display Montserrat 800, 96–140 px, tracking -0.02em, line-height 0.98;
         body Inter 400/600, 30–40 px; code JetBrains Mono 400, 26–30 px;
         medium: a dark studio sweep photographed at 35 mm — product surfaces are flat-lit HTML with a 0.55 contact shadow (0 24px 80px rgba(0,0,0,0.55)), 12 px radius on windows, 2 px hairline borders;
         light: key upper-left, rim behind the window edge (1 px top highlight rgba(242,237,227,0.14))
OBJECTS: browser window (chrome bar, three dots, URL pill, live pharmacy dashboard: sidebar, order rows ticking, a line chart drawing itself);
         terminal window (prompt line, typed sentence, streaming log lines);
         code editor (file tabs, line numbers, syntax-tinted code assembling block by block);
         cursor: 84 px arrow (4.4% of frame width), enters from off-screen, its click causes the next event on the same frame;
         the mark: a 120 px molten square rotated 45° with a bone core — carried, never docked
MOTION:  enter expo.out 0.50 s; camera power2.inOut 0.60 s; exit power3.in 0.28 s (exits 44% of enters);
         word stagger 0.07 s; list stagger 0.06 s; overlap: next element starts at 60% of the previous;
         springs: none on opacity/colour; position only where named, damping 0.8 (premium, no visible bounce);
         titles: per-word blur 6px→0 + opacity in 0.13 s, then DEAD STILL until exit (blur-out 0.18 s);
         hero move per shot only; secondary moves travel 60% as far, start 0.15 s later
SHOTS:   S1  f0–90    (0–3 s)    hero: slow pull-back 1.06→1.00 on the living dashboard | viewer reads: a finished product, already working | sound: pulse enters at bar 2 | hand-off: chrome edge becomes the frame of S2
         S2  f90–210  (3–7 s)    hero: one frame rebuilds — tabs multiply, then freeze | reads: the old way, churning, in one held composition | sound: near silence | hand-off: a single sentence wipes the churn away (colour flood, ground holds, content floods to bone line)
         S3  f210–300 (7–10 s)   hero: wordmark assembles letter by letter | reads: MUSE CODE, then "powered by muse-wonder-1.0" | sound: pulse opens | hand-off: last letter's counter becomes the terminal cursor
         S4  f300–450 (10–15 s)  hero: sentence types, log streams | reads: "Build a pharmacy that never sleeps" → plan appears | sound: key ticks on typed line only | hand-off: log's last line morphs into the editor's first file tab
         S5  f450–630 (15–21 s)  hero: code blocks assemble, chart draws | reads: design → code → test, three verbs in one window | sound: soft ticks per block | hand-off: the drawn chart lifts out and becomes the dashboard chart
         S6  f630–750 (21–25 s)  hero: punch-in on one control, click, result populates | reads: Refine — one click, the UI answers | sound: one click on the click frame | hand-off: result card carries across into the payoff window
         S7  f750–930 (25–31 s)  hero: payoff at normal speed, camera slow orbit 3°/s | reads: the product, finished, in use — orders flow | sound: riser into downbeat at f750, then full bed | hand-off: last order row's accent line extends into the claim's underline
         S8  f930–1080 (31–36 s) hero: claim lands, mark is forged from a line of code | reads: "You describe it. It ships." then mark + MUSE CODE + "Start building" held from f990 | sound: mark lands on downbeat, bed fades under card | hand-off: hold
BANNED:  a black/dark void with small elements floating in its middle; glow, bloom, neon, lens flares, glowing orbs/rings, floating particles;
         purple/blue gradients, mesh gradients, glass cards; cream-paper-serif-mono-label look; numbered 01/02 labels; pill chips as decoration;
         everything centred; everything fading/sliding up the same way; text moving while read; titles drifting after landing;
         corner labels, frame borders, corner brackets, HUD readouts as decoration; three cards in a row; KPI grids; title over a dimmed screenshot; docked logo;
         typing-into-a-prompt-box as the opener; a feature list; "unlock / seamless / supercharge / game-changer / revolutionize / effortless / in seconds"
QA:      f0 (product alive, fills frame), f45 (pull-back mid), f150 (churn held), f255 (wordmark landed, dead still),
         f375 (sentence typed), f540 (code mid-assembly), f690 (click frame), f840 (payoff at speed), f1005 (claim read), f1050 (end card held)
