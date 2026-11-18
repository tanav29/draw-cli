import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = "http://draw.local";
const dist = new URL("./dist/", import.meta.url);
const html = `<!doctype html>
<meta charset="utf-8">
<title>Draw CLI renderer</title>
<script>
  window.EXCALIDRAW_ASSET_PATH = "/";
  window.EXCALIDRAW_EXPORT_SOURCE = "draw-cli";
</script>
<script type="module" src="/renderer.js"></script>`;

export async function runRenderer(method, data) {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error.message.includes("Executable doesn't exist")) {
      throw new Error("Chromium is missing. Run npm run setup in the Draw CLI project.");
    }
    throw error;
  }

  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    let loadError;
    page.on("pageerror", (error) => { loadError ??= error; });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname === "/") {
          return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
        }
        if (url.pathname === "/renderer.js" || /^\/fonts\/[\w-]+\/[\w.-]+\.woff2$/.test(url.pathname)) {
          const asset = new URL(url.pathname.slice(1), dist);
          return route.fulfill({ path: fileURLToPath(asset) });
        }
      }
      return route.abort();
    });
    await page.goto(origin, { timeout: 10000 });
    if (loadError) throw loadError;
    await page.waitForFunction(() => Boolean(window.drawRenderer), { timeout: 10000 });
    return await page.evaluate(([name, payload]) => window.drawRenderer[name](payload), [method, data]);
  } finally {
    await browser.close();
  }
}
