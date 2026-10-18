export const controlStyles = `
@layer components {
.ui-button, .ui-input, .ui-select, .ui-switch {
  box-sizing: border-box;
  font-family: var(--mew-font-sans, var(--font-sans, system-ui, sans-serif));
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  max-width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: min(var(--radius-sm, 4px), 4px);
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  appearance: none;
  user-select: none;
  transition: background-color 120ms ease-out, color 120ms ease-out, opacity 120ms ease-out;
}
.ui-button[data-variant='primary'] {
  background: var(--color-action, var(--color-highlight, var(--color-primary)));
  color: var(--color-on-action, var(--color-background));
}
.ui-button[data-variant='primary']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-action, var(--color-highlight, var(--color-primary))) 88%, var(--color-background));
}
.ui-button[data-variant='secondary'] {
  background: var(--color-tertiary);
  color: var(--color-primary);
}
.ui-button[data-variant='secondary']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-tertiary) 86%, var(--color-primary));
}
.ui-button[data-variant='ghost'] {
  background: transparent;
  color: var(--color-secondary);
}
.ui-button[data-variant='ghost']:hover:not(:disabled) {
  background: var(--color-row, var(--color-tertiary));
  color: var(--color-primary);
}
.ui-button[data-variant='ghost'][aria-expanded='true'], .ui-button[data-variant='ghost'][aria-pressed='true'] {
  background: var(--color-selected, var(--color-tertiary));
  color: var(--color-primary);
}
.ui-button[data-variant='destructive'] {
  background: var(--color-danger, #b74952);
  color: var(--color-on-danger, #fff);
}
.ui-button[data-variant='destructive']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger, #b74952) 88%, var(--color-background));
}
.ui-button[role='menuitem'] { justify-content: flex-start; text-align: left; }
.ui-button[data-icon-only='true'] { width: 32px; padding: 8px; }
.ui-button .tui-spinner { color: inherit; }
.ui-button:active:not(:disabled) { filter: brightness(.94); }
.ui-button:disabled, .ui-input:disabled, .ui-select:disabled, .ui-switch:disabled { opacity: .45; cursor: not-allowed; }
.ui-input, .ui-select {
  min-width: 0;
  max-width: 100%;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid var(--color-tertiary);
  border-radius: min(var(--radius-sm, 4px), 4px);
  background: var(--color-background);
  color: var(--color-primary);
}
.ui-input::placeholder { color: var(--color-secondary); opacity: 1; }
.ui-input[aria-invalid='true'] { border-color: var(--color-danger, #b74952); }
.ui-select { cursor: pointer; }
.ui-select[role='combobox'] { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; }
.ui-switch {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 24px;
  padding: 2px;
  border: 0;
  border-radius: 9999px;
  background: var(--color-tertiary);
  cursor: pointer;
  appearance: none;
}
.ui-switch-thumb { display: block; width: 20px; height: 20px; border-radius: 9999px; background: var(--color-primary); }
.ui-switch[aria-checked='true'] { background: var(--color-action, var(--color-highlight, var(--color-primary))); }
.ui-switch[aria-checked='true'] .ui-switch-thumb { background: var(--color-on-action, var(--color-background)); transform: translateX(20px); }
.ui-button:focus-visible:not(:disabled), .ui-input:focus-visible, .ui-select:focus-visible, .ui-switch:focus-visible:not(:disabled) {
  outline: none;
  box-shadow: none;
  background: var(--color-selected, var(--color-tertiary));
}
.ui-button[data-variant='secondary']:focus-visible:not(:disabled), .ui-switch:focus-visible:not(:disabled) { background: color-mix(in srgb, var(--color-tertiary) 78%, var(--color-primary)); }
.ui-button[data-variant='primary']:focus-visible:not(:disabled), .ui-switch[aria-checked='true']:focus-visible:not(:disabled) { background: color-mix(in srgb, var(--color-action, var(--color-highlight, var(--color-primary))) 78%, var(--color-background)); }
.ui-button[data-variant='destructive']:focus-visible:not(:disabled) { background: color-mix(in srgb, var(--color-danger, #b74952) 78%, var(--color-background)); }
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 5px;
  border-radius: min(var(--radius-sm, 4px), 2px);
  background: color-mix(in srgb, var(--color-background) 93%, var(--color-primary));
  color: var(--color-secondary);
  font-family: var(--mew-font-sans, var(--font-sans, system-ui, sans-serif));
  font-size: 11px;
  font-weight: 400;
  line-height: 16px;
  white-space: nowrap;
}
@media (max-width: 767px) {
  .ui-button, .ui-input, .ui-select { min-height: 40px; font-size: 16px; }
  .ui-button { padding-block: 10px; }
  .ui-button[data-icon-only='true'] { width: 40px; padding: 8px; }
  .ui-input, .ui-select { padding-block: 9px; }
}
@media (prefers-reduced-motion: reduce) { .ui-button { transition: none; } }
@media (forced-colors: active) {
  .ui-button, .ui-input, .ui-select, .ui-switch { border: 1px solid ButtonText; }
  .ui-button[data-variant]:focus-visible:not(:disabled), .ui-input:focus-visible, .ui-select:focus-visible, .ui-switch[aria-checked]:focus-visible:not(:disabled) { forced-color-adjust: none; background: Highlight; color: HighlightText; outline: 2px solid Highlight; outline-offset: 2px; box-shadow: none; }
  .ui-button[data-variant='primary'], .ui-switch[aria-checked='true'] { forced-color-adjust: none; background: Highlight; color: HighlightText; }
  .ui-switch-thumb { forced-color-adjust: none; background: ButtonText; }
  .ui-switch[aria-checked='true'] .ui-switch-thumb { background: HighlightText; }
  .ui-switch:focus-visible:not(:disabled) .ui-switch-thumb { background: HighlightText; }
}
}
`;
