import type { NextConfig } from "next";

// App interna con sesión: todas las páginas son dinámicas (dependen del usuario),
// por eso no se usa cacheComponents.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
