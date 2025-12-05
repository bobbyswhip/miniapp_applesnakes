/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {},
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // Add pino and thread-stream to externals to avoid Turbopack/bundling issues
    config.externals.push('pino-pretty', 'lokijs', 'encoding', 'pino', 'thread-stream');

    // Fix MetaMask SDK React Native dependencies
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    return config;
  },
  // Unity WebGL Brotli-compressed files - rewrite requests to .br files
  async rewrites() {
    return [
      // Map uncompressed URLs to Brotli-compressed files
      {
        source: '/unity/WebGLBuild/Build/WebGLBuild.data',
        destination: '/unity/WebGLBuild/Build/WebGLBuild.data.br',
      },
      {
        source: '/unity/WebGLBuild/Build/WebGLBuild.framework.js',
        destination: '/unity/WebGLBuild/Build/WebGLBuild.framework.js.br',
      },
      {
        source: '/unity/WebGLBuild/Build/WebGLBuild.wasm',
        destination: '/unity/WebGLBuild/Build/WebGLBuild.wasm.br',
      },
    ];
  },
  // Set Content-Encoding headers for Brotli-compressed Unity files
  async headers() {
    return [
      {
        source: '/unity/WebGLBuild/Build/:path*.br',
        headers: [
          {
            key: 'Content-Encoding',
            value: 'br',
          },
        ],
      },
      {
        source: '/unity/WebGLBuild/Build/WebGLBuild.data',
        headers: [
          {
            key: 'Content-Encoding',
            value: 'br',
          },
          {
            key: 'Content-Type',
            value: 'application/octet-stream',
          },
        ],
      },
      {
        source: '/unity/WebGLBuild/Build/WebGLBuild.framework.js',
        headers: [
          {
            key: 'Content-Encoding',
            value: 'br',
          },
          {
            key: 'Content-Type',
            value: 'application/javascript',
          },
        ],
      },
      {
        source: '/unity/WebGLBuild/Build/WebGLBuild.wasm',
        headers: [
          {
            key: 'Content-Encoding',
            value: 'br',
          },
          {
            key: 'Content-Type',
            value: 'application/wasm',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      // Alchemy CDN (primary - fastest)
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'nft-cdn.alchemy.com' },
      { protocol: 'https', hostname: 'alchemy.mypinata.cloud' },
      // IPFS gateways for NFT images (fallback)
      { protocol: 'https', hostname: 'surrounding-amaranth-catshark.myfilebase.com' },
      { protocol: 'https', hostname: 'cloudflare-ipfs.com' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: 'dweb.link' },
    ],
  },
}

module.exports = nextConfig
