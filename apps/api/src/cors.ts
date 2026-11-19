/**
 * WEB_ORIGIN may hold one or more comma-separated origins. Browsers send the
 * Origin header without a path or trailing slash, so normalise each entry
 * (a stray "/" previously made CORS reject every request from the web app).
 */
export function allowedOrigins(value = process.env.WEB_ORIGIN): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origins.length ? origins : ['http://localhost:3000'];
}
