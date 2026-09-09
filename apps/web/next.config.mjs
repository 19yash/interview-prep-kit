/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API is a separate origin; nothing is proxied, so the browser talks to
  // it directly with credentials and the API allows that origin by CORS.
  env: {},
}

export default nextConfig
