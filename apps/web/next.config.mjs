/** @type {import('next').NextConfig} */

// When the web app and the API live on different sites (vercel.app and
// onrender.com), the session cookie is third-party and browsers that block
// third-party cookies never send it back, so every request after login is a
// 401. Setting API_PROXY_URL makes Next proxy /api/* to the API, the browser
// only ever talks to this origin, and the cookie becomes first-party. Pair it
// with NEXT_PUBLIC_API_URL=/ so the client calls relative paths.
const apiProxyUrl = (process.env.API_PROXY_URL ?? '').replace(/\/+$/, '')

const nextConfig = {
  reactStrictMode: true,
  env: {},
  async rewrites() {
    if (!apiProxyUrl) return []
    return [{ source: '/api/:path*', destination: `${apiProxyUrl}/api/:path*` }]
  },
}

export default nextConfig
