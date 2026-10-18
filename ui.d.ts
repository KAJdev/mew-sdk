export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ControlThemeToken = "--color-background" | "--color-primary" | "--color-secondary" | "--color-tertiary" | "--color-row" | "--color-selected" | "--color-action" | "--color-on-action" | "--color-danger" | "--color-on-danger" | "--color-focus" | "--radius-sm" | "--mew-font-sans";
export type ControlTheme = Partial<Record<ControlThemeToken, string>>;
export type ButtonProps = {
  text: string;
  variant?: ButtonVariant;
  type?: "button" | "submit" | "reset";
  id?: string;
  name?: string;
  value?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (event: MouseEvent) => void;
};
export type FieldProps = {
  id?: string;
  name?: string;
  value?: string;
  label?: string;
  describedBy?: string;
  invalid?: boolean;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  autocomplete?: string;
  onInput?: (value: string, event: Event) => void;
  onChange?: (value: string, event: Event) => void;
};
export type InputProps = FieldProps & { type?: string; min?: string | number; max?: string | number; step?: string | number };
export type TextareaProps = FieldProps & { rows?: number };
export type SelectProps = Pick<FieldProps, "id" | "name" | "value" | "label" | "describedBy" | "invalid" | "className" | "disabled" | "required" | "onInput" | "onChange"> & {
  options: readonly { value: string; label: string; disabled?: boolean }[];
};
export interface UIControls {
  install(): void;
  button(props: ButtonProps): HTMLButtonElement;
  input(props?: InputProps): HTMLInputElement;
  select(props: SelectProps): HTMLSelectElement;
  textarea(props?: TextareaProps): HTMLTextAreaElement;
}
export function installUI(): void;
export function button(props: ButtonProps): HTMLButtonElement;
export function input(props?: InputProps): HTMLInputElement;
export function select(props: SelectProps): HTMLSelectElement;
export function textarea(props?: TextareaProps): HTMLTextAreaElement;
