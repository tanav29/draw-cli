import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageEntry = new URL(import.meta.resolve("@excalidraw/excalidraw"));
const dist = new URL("./dist/", import.meta.url);

await build({
  entryPoints: [fileURLToPath(new URL("./renderer.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("renderer.js", dist)),
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  conditions: ["production"],
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": "false",
  },
});

await cp(new URL("./fonts/", packageEntry), new URL("fonts/", dist), {
  recursive: true,
});
