import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@thm/db', '@thm/music-sources', '@thm/ui'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.music.126.net' },
      { protocol: 'https', hostname: 'y.qq.com' },
      { protocol: 'https', hostname: 'y.gtimg.cn' },
      { protocol: 'https', hostname: 'imge.kugou.com' },
      { protocol: 'https', hostname: '*.hdslb.com' },
    ],
  },
};

export default config;
