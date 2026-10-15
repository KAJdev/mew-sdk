import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
export const bootstrapSource = read("bootstrap.js");
export const sampleHtml = read("sample.html");
export const version = JSON.parse(read("package.json")).version;
