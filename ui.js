function controls() {
  const ui = globalThis.mew?.ui;
  if (!ui) throw new Error("Shared controls require the mew app frame SDK");
  return ui;
}

export const installUI = () => controls().install();
export const button = (props) => controls().button(props);
export const input = (props) => controls().input(props);
export const select = (props) => controls().select(props);
export const textarea = (props) => controls().textarea(props);
