// Usage:
//   TOKEN=your_auth_token node generate_from_file.mjs prompts.txt --count=4 --out=./out
//
// Windows (PowerShell):
//   $env:TOKEN="your_auth_token"; node .\generate_from_file.mjs .\prompts.txt --count=4 --out=./out

import fs from "fs";
import path from "path";
import ImageFx from "@rohitaryal/imagefx-api";

// ---- parse args ----
const [, , inputPath, ...rest] = process.argv;
if (!inputPath) {
  console.error("Usage: node generate_from_file.mjs <prompts.txt> [--count=4] [--out=./out] [--model=IMAGEN_4] [--ratio=IMAGE_ASPECT_RATIO_LANDSCAPE] [--seed=123]");
  process.exit(1);
}
const opts = Object.fromEntries(
  rest.map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const COUNT = Number(opts.count ?? 4);
const OUTDIR = String(opts.out ?? "./out");
const MODEL = String(opts.model ?? "IMAGEN_4");
const RATIO = String(opts.ratio ?? "IMAGE_ASPECT_RATIO_LANDSCAPE");
const SEED  = opts.seed !== undefined ? Number(opts.seed) : null;

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Missing TOKEN env var. See repo README > Help to extract it.");
  process.exit(1);
}

const fx = new ImageFx({ authorizationKey: TOKEN });

// ---- helpers ----
function loadPrompts(file) {
  const raw = fs.readFileSync(file, "utf8");
  return raw
    .split(/\r?\n\s*\r?\n/g) // blank-line blocks
    .map(b => b.trim())
    .filter(Boolean);
}

// ---- sequential numbering with gaps ----
let globalIndex = 1;                   // Increments for every *attempted* image
const manifestPath = path.join(OUTDIR, "manifest.txt");
function note(line) {
  fs.appendFileSync(manifestPath, line + "\n");
}

async function generateForPrompt(prompt, pIdx) {
  console.log(`\n▶ Prompt ${pIdx + 1}: ${prompt}`);

  let ok = [];
  try {
    const resp = await fx.generateImage({
      prompt,
      count: COUNT,
      model: MODEL,
      ratio: RATIO,
      seed: SEED
    });
    if (resp && resp.Ok) ok = resp.Ok;
  } catch (e) {
    // fall through to gap reservation below
  }

  // Ensure output & manifest exist
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
  if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, "");

  // We "attempt" COUNT images per prompt: for each attempt either save (if we have one)
  // or leave a gap and record it in manifest.
  for (let j = 0; j < COUNT; j++) {
    const filename = `${globalIndex}.png`;
    const filepath = path.join(OUTDIR, filename);

    if (j < ok.length && ok[j] && ok[j].encodedImage) {
      fs.writeFileSync(filepath, ok[j].encodedImage, "base64");
      console.log(`   ✔ Saved ${filepath}`);
      note(`${filename} | prompt #${pIdx + 1} | "${prompt}"`);
    } else {
      console.warn(`   ⚠ Gap reserved at ${filename} (no image returned)`);
      note(`${filename} | GAP | prompt #${pIdx + 1} | "${prompt}"`);
      // nothing written; number is intentionally skipped
    }
    globalIndex++;
  }
}

(async () => {
  try {
    const prompts = loadPrompts(inputPath);
    if (prompts.length === 0) {
      console.error("No prompts found. Ensure prompts are separated by a blank line.");
      process.exit(1);
    }
    fs.mkdirSync(OUTDIR, { recursive: true });
    fs.writeFileSync(manifestPath, ""); // reset manifest for this run

    for (let i = 0; i < prompts.length; i++) {
      await generateForPrompt(prompts[i], i);
    }

    console.log(`\nAll done. See manifest: ${manifestPath}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
