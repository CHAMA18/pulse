"use strict";

/**
 * electron-builder skips signing when no Developer ID certificate is
 * installed. An unsigned .app bundle is rejected by Gatekeeper as "damaged"
 * once macOS adds the download quarantine flag.
 *
 * Ad-hoc signing gives the bundle a valid sealed signature so it can be
 * opened (right-click → Open on first launch). When a Developer ID identity
 * is available, electron-builder replaces this signature with the real one
 * and notarizes the app.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  // Universal builds pack each architecture into a -temp directory first.
  // Sign only the merged app; signing the halves breaks the merge.
  if (context.appOutDir.endsWith("-temp")) return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot sign missing app bundle: ${appPath}`);
  }

  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
