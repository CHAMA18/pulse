/* Mobile + reduced-motion verification of the new landing page. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  try {
    // --- mobile (iPhone 14-ish) ---
    const mob = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await mob.goto("http://localhost:4173/pulse/", { waitUntil: "networkidle" });
    await mob.waitForTimeout(2200);
    await mob.screenshot({ path: "/tmp/render/m1-hero.png" });

    // open the hamburger menu
    await mob.click('button[aria-label="Open menu"]');
    await mob.waitForTimeout(400);
    await mob.screenshot({ path: "/tmp/render/m2-menu.png" });
    await mob.click('button[aria-label="Close menu"]').catch(() => {});

    // demo section on mobile
    await mob.evaluate(() =>
      document.getElementById("demo").scrollIntoView({ behavior: "instant" })
    );
    await mob.waitForTimeout(3500);
    await mob.screenshot({ path: "/tmp/render/m3-demo.png" });

    // horizontal overflow check (whole page)
    const overflow = await mob.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    console.log("mobile horizontal overflow px:", overflow);

    // --- reduced motion (static poster expected) ---
    const rm = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    await rm.goto("http://localhost:4173/pulse/", { waitUntil: "networkidle" });
    await rm.evaluate(() =>
      document.getElementById("demo").scrollIntoView({ behavior: "instant" })
    );
    await rm.waitForTimeout(1200);
    await rm.screenshot({ path: "/tmp/render/r1-poster.png" });
    const posterVisible = await rm.evaluate(() => {
      const el = document.querySelector("#demo .grid.grid-cols-1");
      return Boolean(el);
    });
    console.log("reduced-motion static poster rendered:", posterVisible);

    await browser.close();
    console.log("MOBILE/RM CHECKS DONE");
  } catch (e) {
    console.error("CHECK FAILED:", e.message);
    await browser.close();
    process.exit(1);
  }
})();
