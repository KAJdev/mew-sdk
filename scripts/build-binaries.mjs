import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "dist"));
const targets = (process.env.MEW_TARGETS ?? "linux-x64,linux-arm64,darwin-x64,darwin-arm64,windows-x64").split(",");
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;

const inlineAssets = {
  name: "inline-assets",
  setup(build) {
    build.onLoad({ filter: /[\\/]assets\.mjs$/ }, async () => ({
      loader: "js",
      contents: `export const bootstrapSource = ${JSON.stringify(await readFile(path.join(root, "bootstrap.js"), "utf8"))};\n` +
        `export const sampleHtml = ${JSON.stringify(await readFile(path.join(root, "sample.html"), "utf8"))};\n` +
        `export const handlerSource = ${JSON.stringify(await readFile(path.join(root, "handler.js"), "utf8"))};\n` +
        `export const version = ${JSON.stringify(version)};\n`,
    }));
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const bundle = await Bun.build({ entrypoints: [path.join(root, "cli/bin/mew.js")], target: "bun", plugins: [inlineAssets], outdir: path.join(out, ".bundle") });
if (!bundle.success) throw new AggregateError(bundle.logs, "bundle failed");
const entry = bundle.outputs[0].path;
const sums = [];
for (const target of targets) {
  const file = `mew-${target}${target.startsWith("windows") ? ".exe" : ""}`;
  const result = Bun.spawnSync(["bun", "build", "--compile", `--target=bun-${target}`, entry, "--outfile", path.join(out, file)], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`compile failed for ${target}`);
  sums.push(`${createHash("sha256").update(await readFile(path.join(out, file))).digest("hex")}  ${file}`);
}
await rm(path.join(out, ".bundle"), { recursive: true, force: true });
await writeFile(path.join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`built mew ${version} for ${targets.join(", ")} in ${out}`);
