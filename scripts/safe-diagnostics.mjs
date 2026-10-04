/** Report the presence of an external request without storing URL paths or tokens. */
export function externalRequestDiagnostic(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname === 'tauri.localhost' || url.hostname === 'ipc.localhost') return null;
    return 'external-request';
  } catch {
    return 'invalid-request-url';
  }
}

/** Frame names, URLs, and attributes may contain short-lived Connect Tokens. */
export function frameDiagnostic(frame) {
  return { framePresent: Boolean(frame) };
}
