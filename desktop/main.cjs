"use strict";

/**
 * Pulse — desktop shell.
 *
 * The web console is exported statically (next build with NEXT_EXPORT) and
 * served from a loopback-only HTTP server inside the app. Using HTTP instead
 * of file:// keeps ES modules, service workers and Firebase Auth working with
 * a real origin (http://localhost) — the same origin Firebase authorises for
 * local sign-in.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DIST = path.join(__dirname, "app");
const START_PATH = "/auth/";
const APP_ID = "africa.pulse.desktop";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".map": "application/json; charset=utf-8",
};

/** Firebase auth popups need to stay inside the app to return a credential. */
const AUTH_HOSTS = /(^|\.)(google\.com|firebaseapp\.com|gstatic\.com|googleapis\.com)$/i;

let mainWindow = null;
let staticServer = null;

function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "mailto:") {
      void shell.openExternal(url.href);
    }
  } catch {
    /* Ignore malformed links from the page. */
  }
}

function isAuthUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && AUTH_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

function createStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url || "/", "http://localhost");
        const pathname = decodeURIComponent(requestUrl.pathname);
        let filePath = path.normalize(path.join(DIST, pathname));

        if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
          response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        if (!fs.existsSync(filePath) && path.extname(filePath) === "") {
          const htmlPath = `${filePath}.html`;
          if (fs.existsSync(htmlPath)) filePath = htmlPath;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const extension = path.extname(filePath).toLowerCase();
        const headers = {
          "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
        };
        if (pathname.startsWith("/_next/static/")) {
          headers["Cache-Control"] = "public, max-age=31536000, immutable";
        } else if (extension === ".html") {
          headers["Cache-Control"] = "no-cache";
        }

        response.writeHead(200, headers);
        const stream = fs.createReadStream(filePath);
        stream.on("error", () => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
        stream.pipe(response);
      } catch {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Server error");
      }
    });

    server.once("error", reject);
    server.listen(0, "localhost", () => resolve(server));
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(appUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "Pulse",
    backgroundColor: "#0b0517",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const local = url.startsWith(appUrl);
    // about:blank / blob: popups back Firebase sign-in and the PDF preview.
    const internalPopup = url === "about:blank" || url.startsWith("blob:");
    if (local || internalPopup || isAuthUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 480,
          height: 680,
          autoHideMenuBar: true,
          backgroundColor: "#ffffff",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(new URL(START_PATH, appUrl).href);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    if (process.platform === "darwin") buildMenu();
    else Menu.setApplicationMenu(null);

    if (!fs.existsSync(path.join(DIST, "index.html"))) {
      dialog.showErrorBox(
        "Pulse couldn't start",
        "The bundled application files are missing. Please reinstall Pulse."
      );
      app.quit();
      return;
    }

    try {
      staticServer = await createStaticServer();
    } catch (error) {
      dialog.showErrorBox("Pulse couldn't start", String(error));
      app.quit();
      return;
    }

    const address = staticServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    createWindow(`http://localhost:${port}`);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(`http://localhost:${port}`);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    staticServer?.close();
    staticServer = null;
  });
}
