/* Measure demo-theater frame geometry at mobile width. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  await page.goto("http://localhost:4173/pulse/", { waitUntil: "networkidle" });
  await page.evaluate(() =>
    document.getElementById("demo").scrollIntoView({ behavior: "instant" })
  );
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const frame = document.querySelector(".demo-frame");
    const screen = frame?.querySelector(".relative.aspect-\\[4\\/3\\]");
    const r = frame?.getBoundingClientRect();
    const sr = screen?.getBoundingClientRect();
    const stage = document.querySelector("#demo .demo-theater");
    const st = stage?.getBoundingClientRect();
    return {
      viewportW: window.innerWidth,
      frameLeft: r?.left,
      frameRight: r?.right,
      frameW: r?.width,
      theaterLeft: st?.left,
      theaterRight: st?.right,
      screenW: sr?.width,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  });
  console.log(JSON.stringify(m, null, 2));
  await browser.close();
})();
