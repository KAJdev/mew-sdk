export function controlTheme(source) {
  const result = {};
  for (const key of ["--color-background", "--color-primary", "--color-secondary", "--color-tertiary", "--color-row", "--color-selected", "--color-action", "--color-on-action", "--color-danger", "--color-on-danger", "--color-focus", "--radius-sm", "--mew-font-sans"]) {
    const raw = typeof source?.getPropertyValue === "function" ? source.getPropertyValue(key) : source?.[key];
    if (typeof raw !== "string" || !raw.trim() || raw.length > 256 || /[\u0000-\u001f\u007f]/.test(raw)) continue;
    const value = raw.trim();
    if (key === "--radius-sm") {
      const length = /^(\d+(?:\.\d+)?|\.\d+)(px|rem)$/.exec(value);
      if (!length) continue;
      const size = Number(length[1]) * (length[2] === "rem" ? parseFloat(source.fontSize) : 1);
      if (Number.isFinite(size)) result[key] = `${Math.min(4, Math.max(0, size))}px`;
    } else if (key === "--mew-font-sans") {
      if (CSS.supports("font-family", value)) result[key] = value;
    } else if (CSS.supports("color", value)) result[key] = value;
  }
  return result;
}

export function createUI(controlStyles, validateTheme) {
  let watching = false;
  let projected = [];

  function applyTheme(theme) {
    const tokens = validateTheme(theme?.controls);
    const root = document.documentElement;
    for (const key of projected) if (!Object.hasOwn(tokens, key)) root.style.removeProperty(key);
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
    projected = Object.keys(tokens);
  }

  function install() {
    let style = document.head.querySelector('style[data-mew-ui="controls"]');
    if (!style) {
      style = document.createElement("style");
      style.dataset.mewUi = "controls";
      document.head.append(style);
    }
    if (style.textContent !== controlStyles) style.textContent = controlStyles;
    if (!watching) {
      watching = true;
      applyTheme(globalThis.mew.theme.get());
      globalThis.mew.theme.subscribe(applyTheme);
    }
  }

  function configure(element, props, className) {
    install();
    element.className = `${className}${props.className ? ` ${props.className}` : ""}`;
    for (const key of ["id", "name", "value", "placeholder", "disabled", "required", "readOnly", "min", "max", "step", "minLength", "maxLength", "rows", "autocomplete"]) {
      if (props[key] !== undefined && key in element) element[key] = props[key];
    }
    if (props.label !== undefined) element.setAttribute("aria-label", props.label);
    if (props.describedBy !== undefined) element.setAttribute("aria-describedby", props.describedBy);
    if (props.invalid !== undefined) element.setAttribute("aria-invalid", String(props.invalid));
    if (props.onInput) element.addEventListener("input", (event) => props.onInput(element.value, event));
    if (props.onChange) element.addEventListener("change", (event) => props.onChange(element.value, event));
    return element;
  }

  function button(props) {
    const variant = props.variant ?? "secondary";
    if (!["primary", "secondary", "ghost", "destructive"].includes(variant)) throw new TypeError("Invalid button variant");
    const element = configure(document.createElement("button"), props, "ui-button");
    element.type = props.type ?? "button";
    element.dataset.variant = variant;
    element.textContent = props.text;
    element.disabled = Boolean(props.disabled || props.loading);
    if (props.loading) element.setAttribute("aria-busy", "true");
    if (props.onClick) element.addEventListener("click", props.onClick);
    return element;
  }

  function input(props = {}) {
    const element = document.createElement("input");
    element.type = props.type ?? "text";
    return configure(element, props, "ui-input");
  }

  function textarea(props = {}) {
    return configure(document.createElement("textarea"), props, "ui-input");
  }

  function select(props) {
    const element = document.createElement("select");
    for (const item of props.options) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      option.disabled = Boolean(item.disabled);
      element.append(option);
    }
    return configure(element, props, "ui-select");
  }

  return Object.freeze({ install, button, input, select, textarea });
}
