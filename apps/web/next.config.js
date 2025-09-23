/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), camera=()' },
];

const nextConfig = {
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
};

module.exports = nextConfig;
