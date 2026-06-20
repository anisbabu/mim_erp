/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // proxy API to Spring Boot in dev so the browser hits one origin
      { source: '/api/:path*', destination: 'http://localhost:8080/api/:path*' },
    ];
  },
};
module.exports = nextConfig;
