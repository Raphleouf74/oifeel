
// translate-all.js
// Usage:
//   node translate-all.js
//   node translate-all.js --watch
//   node translate-all.js --overwrite

// Requirements:
//   npm install chokidar fs-extra google-translate-api-x minimist

const fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");
const translate = require("google-translate-api-x");
const minimist = require("minimist");

const argv = minimist(process.argv.slice(2), {
    boolean: ["watch", "overwrite"],
    alias: { w: "watch", o: "overwrite" },
    default: { watch: false, overwrite: false }
});

const LANG_DIR = path.join(__dirname, "lang");
const MANIFEST = path.join(LANG_DIR, "manifest.json");
const SOURCE_CODE = "fr";
const SOURCE_FILE = path.join(LANG_DIR, `${SOURCE_CODE}.json`);

const MAX_CONCURRENCY = 12;
const THROTTLE_DELAY_MS = 40;

async function readManifest() {
    if (!(await fs.pathExists(MANIFEST))) {
        throw new Error(`Manifest not found at ${MANIFEST}`);
    }
    const raw = await fs.readFile(MANIFEST, "utf8");
    const m = JSON.parse(raw);
    if (!Array.isArray(m.languages))
        throw new Error("manifest.json must contain 'languages' array");
    return m.languages;
}

async function loadJson(file) {
    if (!(await fs.pathExists(file))) return null;
    return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, obj) {
    await fs.outputFile(file, JSON.stringify(obj, null, 2), "utf8");
    console.log(`✔ Wrote ${path.basename(file)}`);
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function doTranslate(text, target) {
    if (!text || typeof text !== "string") return text;
    try {
        const res = await translate(text, { to: target });
        return res.text;
    } catch (err) {
        console.warn(`⚠ Translate error (${target}):`, err.message);
        return text;
    }
}

async function translateAll({ overwrite = false } = {}) {
    console.log("=== Starting translation run ===");

    const langs = await readManifest();
    const sourceObj = await loadJson(SOURCE_FILE);
    if (!sourceObj) throw new Error("Source file missing: " + SOURCE_FILE);

    // Keys that should NEVER be translated
    const metaKeys = ["__name__", "__flag__", "__code__","header_title"];

    const keys = Object.keys(sourceObj).filter(k => !metaKeys.includes(k));

    for (const lang of langs) {
        const code = lang.code;
        if (!code) continue;
        if (code === SOURCE_CODE) continue;

        
        const mappedCode = code;

        const targetFile = path.join(LANG_DIR, lang.file || `${code}.json`);
        const existing = await loadJson(targetFile) || {};

        // Ensure meta
        existing.__name__ = lang.name || code;
        existing.__flag__ = lang.flag || "🌐";
        existing.__code__ = code;

        // Build list of keys to translate
        const keysToTranslate = keys.filter(key => {
            const src = sourceObj[key];
            const tgt = existing[key];

            if (typeof src !== "string") return false;

            if (overwrite) return true;

            // new key or unchanged key → translate
            if (!tgt || tgt.trim() === "" || tgt === src) return true;

            return false;
        });

        console.log(`\n→ ${code}: ${keysToTranslate.length} keys to update`);

        for (const key of keysToTranslate) {
            existing[key] = await doTranslate(sourceObj[key], mappedCode);
            await delay(THROTTLE_DELAY_MS);
        }

        await writeJson(targetFile, existing);
        await delay(200);
    }

    console.log("\n=== Translation run finished ===");
}

async function start() {
    await translateAll({ overwrite: argv.overwrite });

    if (argv.watch) {
        console.log("Watching:", SOURCE_FILE);
        let busy = false;

        chokidar.watch(SOURCE_FILE, { ignoreInitial: true }).on("change", async () => {
            if (busy) {
                console.log("Already translating — skipping change.");
                return;
            }
            busy = true;
            try {
                await translateAll({ overwrite: argv.overwrite });
            } catch (err) {
                console.error("Translation error:", err);
            }
            busy = false;
        });
    }
}

start().catch(err => {
    console.error("Fatal error:", err);
});
