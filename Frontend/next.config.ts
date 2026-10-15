import type { NextConfig } from "next";

const nextConfig: NextConfig = {
   images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
};

export default function config(phase: string): NextConfig {
  if (phase === 'phase-production-build') {
    const value = process.env.NEXT_PUBLIC_BACKEND_URL;
    let url: URL | undefined;
    try { url = new URL(value || ''); } catch { /* Fail below without exposing the value. */ }
    if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('NEXT_PUBLIC_BACKEND_URL must be an HTTPS backend origin without an API path, query, fragment or credentials');
    }
  }
  return nextConfig;
}
