export function getMew() {
  const sdk = globalThis.mew;
  if (!sdk || sdk.version !== 1) throw new Error("The mew SDK is only available inside a mew app frame");
  return sdk;
}

export async function updateState(scope, update, { attempts = 3 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error("attempts must be an integer from 1 to 10");
  const sdk = getMew();
  for (let attempt = 1; ; attempt++) {
    const current = await sdk.state.get(scope);
    try {
      return await sdk.state.put(scope, { expected_revision: current.revision, value: await update(current.value) });
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
  }
}

export function watchTheme(listener) {
  const sdk = getMew();
  const theme = sdk.theme.get();
  if (theme) listener(theme);
  return sdk.theme.subscribe(listener);
}
