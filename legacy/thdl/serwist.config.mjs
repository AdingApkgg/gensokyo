/** @type {import("@serwist/build").InjectManifestOptions} */
const config = {
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  globDirectory: ".next",
  globPatterns: ["static/**/*.{js,css,woff2,png,jpg,svg,webp}"],
  modifyURLPrefix: { "static/": "/_next/static/" },
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  disablePrecacheManifest: false,
};

export default config;
