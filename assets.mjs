import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
export const bootstrapSource = read("bootstrap.js");
export const sampleHtml = read("sample.html");
export const handlerSource = read("handler.js");
export const uiSource = read("ui.js");
export const uiFontSource = readFileSync(new URL("./assets/fonts/Geist-wght.woff2", import.meta.url)).toString("base64");
export const version = JSON.parse(read("package.json")).version;
