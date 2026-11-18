import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Font {
  file: string;
  family: string;
  units: number;
  ascender: number;
  descender: number;
  widths: number[];
}

// Advances from the bundled fonts, in font units, for U+0020 through U+007E.
const directory = new URL("../../fonts/", import.meta.url);
const metrics: Record<string, Font> = JSON.parse(readFileSync(new URL("metrics.json", directory), "utf8"));
const families: Record<number, Font> = {
  1: metrics.Virgil,
  3: metrics.Cascadia,
  5: metrics.Excalifont,
  6: metrics.Nunito,
  7: metrics.Lilita,
  8: metrics.ComicShanns,
};

export function fontFor(id = 5, format: "ttf" | "woff2" = "ttf") {
  const font: Font | undefined = families[id];
  return {
    family: font?.family ?? "Arial",
    path: font && fileURLToPath(new URL(font.file.replace(/\.ttf$/, `.${format}`), directory)),
    baseline: font ? (font.ascender + font.descender) / (2 * font.units) : 0.35,
  };
}

export function textWidth(text: string, size: number, id = 5) {
  const font = families[id] ?? metrics.Nunito;
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    units +=
      font.widths[code - 32] ?? (/\p{Mark}/u.test(char) ? 0 : code > 0x2fff ? font.units : font.units * 0.6);
  }
  return (units * size) / font.units;
}

export function wrapText(text: string, width: number, size: number, family: number) {
  if (!Number.isFinite(width)) return text;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (textWidth(paragraph, size, family) <= width) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/u)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, family) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let used = 0;
      for (const char of word) {
        const advance = textWidth(char, size, family);
        if (line && used + advance > width) {
          lines.push(line);
          line = "";
          used = 0;
        }
        line += char;
        used += advance;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}
