/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // In dev, proxy to local Spring Boot. On Render, BACKEND_URL points at the
    // backend service (host:port) so the browser stays same-origin — no CORS.
    const backend = process.env.BACKEND_URL || 'http://localhost:8080';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
    ];
  },
};
module.exports = nextConfig;
