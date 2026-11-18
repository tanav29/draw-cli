import { readFile, writeFile } from "node:fs/promises";
import { extname, parse, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";
import { describeScene, normalizeSpec, validateScene } from "./scene.js";

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
`;

const force = { type: "boolean" } as const;
const format = { type: "string" } as const;
const outputPath = { type: "string", short: "o" } as const;
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
} as const satisfies Record<string, NonNullable<ParseArgsConfig["options"]>>;

async function emit(output: string, contents: string | Buffer, overwrite?: boolean) {
  if (output === "-") {
    process.stdout.write(contents);
    return;
  }
  try {
    await writeFile(output, contents, { flag: overwrite ? "w" : "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(`${output} already exists. Pass --force to overwrite it.`);
    throw error;
  }
  console.error(resolve(output));
}

function specFormat(path: string) {
  return [".yaml", ".yml"].includes(extname(path).toLowerCase()) ? "yaml" : "json";
}

async function exampleYaml(example: string) {
  const { Document, isSeq, isMap } = await import("yaml");
  const document = new Document(JSON.parse(example));
  const elements = document.get("elements", true);
  if (isSeq(elements)) for (const element of elements.items) if (isMap(element)) element.flow = true;
  return document.toString({ lineWidth: 0 });
}

async function readData(input: string, inputFormat = "json") {
  const raw = input === "-" ? await text(process.stdin) : await readFile(input, "utf8");
  const contents = raw.replace(/^\uFEFF/, "");
  try {
    if (inputFormat === "json") return { raw, data: JSON.parse(contents) as unknown };

    const { parseDocument } = await import("yaml");
    const document = parseDocument(contents, {
      schema: "core",
      stringKeys: true,
      resolveKnownTags: false,
    });
    const problem = document.errors[0] ?? document.warnings[0];
    if (problem) throw problem;
    const data = document.toJS({ maxAliasCount: 100 });
    const json =
      JSON.stringify(
        data,
        (key, value) => {
          if (typeof value === "number" && !Number.isFinite(value)) {
            throw new Error(
              `Non-finite number at ${key ? JSON.stringify(key) : "the document root"} cannot be represented in JSON.`,
            );
          }
          return value;
        },
        2,
      ) + "\n";
    return { raw: json, data: data as unknown };
  } catch (error) {
    throw new Error(
      `Invalid ${inputFormat.toUpperCase()} in ${input === "-" ? "stdin" : input}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function numberOption(value: string, key: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`--${key} must be a number from ${minimum} to ${maximum}.`);
  }
  return number;
}

function checkPaths(input: string, output: string) {
  if (input === "-" || output === "-") return;
  const absolute = (path: string) => {
    const resolved = resolve(path);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (absolute(input) === absolute(output)) throw new Error("Input and output must be different files.");
}

type Command = keyof typeof commands;
interface Flags {
  force?: boolean;
  format?: string;
  output?: string;
  from?: string;
  "from-format"?: string;
  help?: boolean;
  scale?: string;
  padding?: string;
  transparent?: boolean;
}

async function main([command, ...args]: string[]) {
  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write(help);
    return;
  }
  if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command "${command}". See draw --help.`);
  const { values: parsed, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...commands[command as Command], help: { type: "boolean", short: "h" } },
  });
  const values = parsed as Flags;
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const [input] = positionals;
  if (positionals.length > 1 || (!input && command !== "init")) {
    throw new Error(
      `draw ${command} expects ${command === "init" ? "at most" : "exactly"} one path. See draw --help.`,
    );
  }

  if (command === "init") {
    const output = input ?? "drawing.json";
    const example = await readFile(new URL("../../examples/agent-loop.json", import.meta.url), "utf8");
    const contents = specFormat(output) === "yaml" ? await exampleYaml(example) : example;
    await emit(output, contents, values.force);
    return;
  }

  if (command === "yaml-to-json") {
    const output = values.output ?? "-";
    checkPaths(input, output);
    const { raw: json } = await readData(input, "yaml");
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
    const { createScene } = await import("./create.js");
    const scene = JSON.stringify(createScene(spec), null, 2);
    await emit(input, scene + "\n", values.force);
    return;
  }

  if (command === "source") {
    if (!["text", "json"].includes(values.format ?? "text"))
      throw new Error("source --format must be text or json.");
    const { raw, data } = await readData(input);
    const summary = validateScene(data);
    process.stdout.write(values.format === "json" ? raw : describeScene(summary));
    return;
  }

  const extension = values.output && extname(values.output).slice(1).toLowerCase();
  const imageFormat = values.format ?? (extension || "png");
  if (imageFormat !== "png" && imageFormat !== "svg") throw new Error("render --format must be png or svg.");
  if (imageFormat === "svg" && values.scale !== undefined) {
    throw new Error("--scale applies to PNG. SVG is resolution-independent.");
  }
  const scale = numberOption(values.scale ?? "1", "scale", 0.01, 16);
  const padding = numberOption(values.padding ?? "24", "padding", 0, 4096);
  const { dir, name } = parse(input === "-" ? "drawing.excalidraw" : input);
  const output = values.output ?? resolve(dir, `${name}.${imageFormat}`);
  checkPaths(input, output);
  const scene = validateScene((await readData(input)).data);
  const { renderScene } = await import("./render.js");
  const image = await renderScene({
    scene,
    format: imageFormat,
    padding,
    scale,
    transparent: values.transparent ?? false,
  });
  await emit(output, image, values.force);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`draw: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
