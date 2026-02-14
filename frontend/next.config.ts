import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  env: {
    NEXT_PUBLIC_VOICE_SERVER_URL: process.env.NEXT_PUBLIC_VOICE_SERVER_URL || process.env.VOICE_SERVER_URL || 'wss://voice-ind.onrender.com/',
  },
};

export default nextConfig;