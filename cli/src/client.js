export class ApiClient {
  constructor(base, token) {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('MEW_API_URL must use HTTPS or literal loopback HTTP, without credentials, query or fragment');
    }
    if (!token || /[\r\n]/.test(token)) throw new Error('Set MEW_TOKEN to your local development account token');
    this.base = url.href.replace(/\/$/, '');
    this.token = token;
  }

  async request(path, method = 'GET', body, installationRevision) {
    if (installationRevision !== undefined && (!Number.isSafeInteger(installationRevision) || installationRevision < 0)) {
      throw new Error('Invalid installation revision');
    }
    const response = await fetch(`${this.base}/v1/${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: this.token, 'Content-Type': 'application/json',
        ...(installationRevision === undefined ? {} : { 'X-Mew-Installation-Revision': String(installationRevision) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (Number(response.headers.get('content-length')) > 1_048_576) {
      await response.body?.cancel();
      throw new Error('API response exceeds 1 MiB');
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1_048_576) {
          await reader.cancel();
          throw new Error('API response exceeds 1 MiB');
        }
        chunks.push(value);
      }
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error(`API returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok) {
      if (response.status === 409) throw new Error('Conflict: publication or state changed. Inspect the current version before retrying.');
      throw new Error(`API request failed (HTTP ${response.status})`);
    }
    return result;
  }
}
