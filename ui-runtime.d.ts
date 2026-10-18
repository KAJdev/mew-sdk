import type { ControlTheme, UIControls } from "./ui.js";
export function controlTheme(source: CSSStyleDeclaration | ControlTheme | undefined): ControlTheme;
export function createUI(controlStyles: string, validateTheme: typeof controlTheme, fontSource: string): UIControls;
