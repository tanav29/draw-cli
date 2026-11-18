#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { extname, parse, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { Document, parseDocument } from "yaml";
import { describeScene, normalizeSpec, validateScene } from "./scene.mjs";

const help = `Usage
  draw init [spec.json|spec.yaml|->] [--force]
  draw create <scene.excalidraw|-> [--from <spec.json|spec.yaml|->]
              [--from-format <json|yaml>] [--force]
  draw yaml-to-json <spec.yaml|-> [-o <spec.json|->] [--force]
  draw render <scene.excalidraw|-> [-o <image.png|image.svg|->]
              [--format <png|svg>] [--padding <px>] [--scale <number>]
              [--transparent] [--force]
  draw source <scene.excalidraw|-> [--format <text|json>]

init    Write an editable example drawing spec (default: drawing.json).
create  Convert a JSON or YAML spec to an editable Excalidraw scene, or create an empty scene.
yaml-to-json  Convert one YAML document to JSON (stdout by default).
render  Export a cropped PNG or SVG. PNG is the default. Use --scale for PNG density.
source  Print a text summary or the original scene JSON.

Use "-" for stdin or stdout where shown. File paths are reported on stderr.
Use --from-format yaml for YAML input on stdin.
Run "npm run setup" once to install the headless renderer's Chromium.
`;

const force = { type: "boolean" };
const format = { type: "string" };
const outputPath = { type: "string", short: "o" };
const commands = {
  init: { force },
  create: { from: { type: "string" }, "from-format": format, force },
  "yaml-to-json": { output: outputPath, force },
  render: {
    output: outputPath,
    format,
    padding: { type: "string", default: "24" },
    scale: { type: "string" },
    transparent: { type: "boolean" },
    force,
  },
  source: { format: { ...format, default: "text" } },
};

async function emit(output, contents, overwrite) {
  if (output === "-") {
    process.stdout.write(contents);
    return;
  }
  try {
    await writeFile(output, contents, { flag: overwrite ? "w" : "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`${output} already exists. Pass --force to overwrite it.`);
    throw error;
  }
  console.error(resolve(output));
}

function specFormat(path) {
  return [".yaml", ".yml"].includes(extname(path).toLowerCase()) ? "yaml" : "json";
}

function exampleYaml(example) {
  const document = new Document(JSON.parse(example));
  for (const element of document.get("elements", true).items) element.flow = true;
  return document.toString({ lineWidth: 0 });
}

async function readData(input, inputFormat = "json") {
  const raw = input === "-" ? await text(process.stdin) : await readFile(input, "utf8");
  const contents = raw.replace(/^\uFEFF/, "");
  try {
    if (inputFormat === "json") return { raw, data: JSON.parse(contents) };

    const document = parseDocument(contents, {
      schema: "core",
      stringKeys: true,
      resolveKnownTags: false,
    });
    const problem = document.errors[0] ?? document.warnings[0];
    if (problem) throw problem;
    const data = document.toJS({ maxAliasCount: 100 });
    const json = JSON.stringify(data, (key, value) => {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`Non-finite number at ${key ? JSON.stringify(key) : "the document root"} cannot be represented in JSON.`);
      }
      return value;
    }, 2) + "\n";
    return { data, json };
  } catch (error) {
    throw new Error(`Invalid ${inputFormat.toUpperCase()} in ${input === "-" ? "stdin" : input}: ${error.message}`);
  }
}

function numberOption(value, key, minimum, maximum) {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`--${key} must be a number from ${minimum} to ${maximum}.`);
  }
  return number;
}

function checkPaths(input, output) {
  if (input === "-" || output === "-") return;
  const absolute = (path) => {
    const resolved = resolve(path);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (absolute(input) === absolute(output)) throw new Error("Input and output must be different files.");
}

async function renderWithBrowser(method, options) {
  const { runRenderer } = await import("./browser.mjs");
  return runRenderer(method, options);
}

async function main([command, ...args]) {
  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write(help);
    return;
  }
  if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command "${command}". See draw --help.`);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...commands[command], help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const [input] = positionals;
  if (positionals.length > 1 || (!input && command !== "init")) {
    throw new Error(`draw ${command} expects ${command === "init" ? "at most" : "exactly"} one path. See draw --help.`);
  }

  if (command === "init") {
    const output = input ?? "drawing.json";
    const example = await readFile(new URL("./examples/agent-loop.json", import.meta.url), "utf8");
    const contents = specFormat(output) === "yaml" ? exampleYaml(example) : example;
    await emit(output, contents, values.force);
    return;
  }

  if (command === "yaml-to-json") {
    const output = values.output ?? "-";
    checkPaths(input, output);
    const { json } = await readData(input, "yaml");
    await emit(output, json, values.force);
    return;
  }

  if (command === "create") {
    const from = values.from;
    const inputFormat = values["from-format"] ?? specFormat(from ?? "-");
    if (!["json", "yaml"].includes(inputFormat)) throw new Error("--from-format must be json or yaml.");
    if (!from && values["from-format"]) throw new Error("--from-format requires --from.");
    if (from) checkPaths(from, input);
    const data = from ? (await readData(from, inputFormat)).data : { elements: [] };
    const spec = normalizeSpec(data);
    const scene = await renderWithBrowser("createScene", spec);
    await emit(input, scene + "\n", values.force);
    return;
  }

  if (command === "source") {
    if (!["text", "json"].includes(values.format)) throw new Error("source --format must be text or json.");
    const { raw, data } = await readData(input);
    const summary = validateScene(data);
    process.stdout.write(values.format === "json" ? raw : describeScene(summary));
    return;
  }

  const extension = values.output && extname(values.output).slice(1).toLowerCase();
  const imageFormat = values.format ?? (extension || "png");
  if (!["png", "svg"].includes(imageFormat)) throw new Error("render --format must be png or svg.");
  if (imageFormat === "svg" && values.scale !== undefined) {
    throw new Error("--scale applies to PNG. SVG is resolution-independent.");
  }
  const scale = numberOption(values.scale ?? "1", "scale", 0.01, 16);
  const padding = numberOption(values.padding, "padding", 0, 4096);
  const { dir, name } = parse(input === "-" ? "drawing.excalidraw" : input);
  const output = values.output ?? resolve(dir, `${name}.${imageFormat}`);
  checkPaths(input, output);
  const scene = validateScene((await readData(input)).data);
  const image = await renderWithBrowser("renderScene", {
    scene, format: imageFormat, padding, scale, transparent: values.transparent ?? false,
  });
  await emit(output, imageFormat === "png" ? Buffer.from(image, "base64") : image, values.force);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`draw: ${error.message}`);
  process.exitCode = 1;
}
