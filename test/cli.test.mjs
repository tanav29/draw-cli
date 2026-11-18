import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));

function run(args, { cwd, input } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    input,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function success(args, options) {
  const result = run(args, options);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

test("create, inspect, and export a native Excalidraw drawing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "draw-cli-"));
  try {
    success(["init", "drawing.json"], { cwd });
    const spec = await readFile(join(cwd, "drawing.json"));
    const sceneBytes = success(["create", "-", "--from", "-"], { cwd, input: spec });
    const scene = JSON.parse(sceneBytes);
    assert.equal(scene.type, "excalidraw");
    assert.equal(scene.source, "draw-cli");
    const arrow = scene.elements.find((element) => element.id === "create-arrow");
    assert.equal(arrow.startBinding.elementId, "write");
    assert.equal(arrow.endBinding.elementId, "create");

    const input = { cwd, input: sceneBytes };
    const summary = success(["source", "-"], input).toString();
    assert.match(summary, /"Write a spec"/);
    assert.match(summary, /\[write -> create\]/);
    assert.deepEqual(success(["source", "-", "--format", "json"], input), sceneBytes);

    success(["render", "-", "--output", "preview.png", "--scale", "2"], input);
    const png = await readFile(join(cwd, "preview.png"));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.ok(png.readUInt32BE(16) > 1000);
    const svg = success(["render", "-", "--output", "-", "--format", "svg", "--transparent"], input);
    assert.match(svg.toString(), /^<svg[\s>]/);
    assert.match(svg.toString(), /The agent drawing loop/);
    assert.match(svg.toString(), /data:.*base64,/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("protect existing files and report invalid arrow references", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "draw-cli-"));
  try {
    success(["init"], { cwd });
    const before = await readFile(join(cwd, "drawing.json"));
    const duplicate = run(["init"], { cwd });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr.toString(), /already exists/);
    assert.deepEqual(await readFile(join(cwd, "drawing.json")), before);
    success(["init", "--force"], { cwd });

    const input = JSON.stringify({ elements: [{ type: "arrow", x: 0, y: 0, end: { id: "missing" } }] });
    const invalid = run(["create", "-", "--from", "-"], { cwd, input });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout.length, 0);
    assert.match(invalid.stderr.toString(), /end must reference a shape or text ID/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("convert YAML and create the same drawing from a file or stdin", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "draw-cli-"));
  try {
    success(["init"], { cwd });
    success(["init", "drawing.yml"], { cwd });
    const json = await readFile(join(cwd, "drawing.json"));
    const yaml = await readFile(join(cwd, "drawing.yml"));
    assert.match(yaml.toString(), /^background:/);
    const converted = success(["yaml-to-json", "drawing.yml"], { cwd });
    assert.deepEqual(JSON.parse(converted), JSON.parse(json));

    const fromFile = success(["create", "-", "--from", "drawing.yml"], { cwd });
    const fromStdin = success(["create", "-", "--from", "-", "--from-format", "yaml"], { cwd, input: yaml });
    assert.deepEqual(success(["source", "-"], { input: fromFile }), success(["source", "-"], { input: fromStdin }));
    const invalid = run(["yaml-to-json", "-"], { input: "x: 1\nx: 2\n" });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout.length, 0);
    assert.match(invalid.stderr.toString(), /Invalid YAML in stdin.*unique/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
