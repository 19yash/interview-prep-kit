import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The API is a separate origin; nothing is proxied, so the browser talks to
  // it directly with credentials and the API allows that origin by CORS.
  env: {},
}

export default config
