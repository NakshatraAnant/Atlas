/** @type {import('next').NextConfig} */
const api = process.env.ATLAS_API_URL ?? 'http://127.0.0.1:4000';
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@atlas/shared'],
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${api}/v1/:path*` },
      { source: '/admin/v1/:path*', destination: `${api}/admin/v1/:path*` },
      { source: '/webhooks/:path*', destination: `${api}/webhooks/:path*` },
      { source: '/healthz', destination: `${api}/healthz` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
