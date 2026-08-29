import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  StaleWhileRevalidate,
  Serwist,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: [{"url":"/_next/static/media/caa3a2e1cccd8315-s.p.16t1db8_9y2o~.woff2","revision":"18bae71b1e1b2bb25321090a3b563103"},{"url":"/_next/static/media/bbc41e54d2fcbd21-s.0gw~uztddq1df.woff2","revision":"a0761690ccf4441ace5cec893b82d4ab"},{"url":"/_next/static/media/8a480f0b521d4e75-s.06d3mdzz5bre_.woff2","revision":"cc728f6c0adb04da0dfcb0fc436a8ae5"},{"url":"/_next/static/media/797e433ab948586e-s.p.0.q-h669a_dqa.woff2","revision":"da83d5f06d825c5ae65b7cca706cb312"},{"url":"/_next/static/media/7178b3e590c64307-s.11.cyxs5p-0z~.woff2","revision":"8ea4f719af3312a055caf09f34c89a77"},{"url":"/_next/static/media/4fa387ec64143e14-s.0q3udbd2bu5yp.woff2","revision":"7b7c0ef93df188a852344fc272fc096b"},{"url":"/_next/static/chunks/turbopack-07pf3wfjma~_q.js","revision":"92694dc95bca9e3c291a4af9581652ad"},{"url":"/_next/static/chunks/14ad72-v1sr6d.js","revision":"b96e239ff323d429e376cc12f53229e1"},{"url":"/_next/static/chunks/13g3m.-ev14y8.js","revision":"9e7cff98b889ffce385f26f99ef37ae5"},{"url":"/_next/static/chunks/13a-do9rqscp6.js","revision":"9ded69f41f57d98be421f5019018225a"},{"url":"/_next/static/chunks/132p-ipk8w6bv.js","revision":"d2f6f0e556fac1bf7d22252d25acdaaa"},{"url":"/_next/static/chunks/11l041wcdipby.js","revision":"9e9f3fc4566eba7b4aa3299168726098"},{"url":"/_next/static/chunks/11jpac8egl_s8.js","revision":"c27843959e43a76480ffb071ef2931c7"},{"url":"/_next/static/chunks/100aqc7sk-dh1.js","revision":"2afdc7b881bcadef65fa1e4e76f0b813"},{"url":"/_next/static/chunks/0z._gur-sxs7u.js","revision":"1417cbecd63a340d2439fb6eb8173240"},{"url":"/_next/static/chunks/0w-y49d_b.r69.js","revision":"77ec196c4c607c9a1860a06a53d81fed"},{"url":"/_next/static/chunks/0saolix_~mdlh.js","revision":"b2ba43bd099b113229e6312bd46e7409"},{"url":"/_next/static/chunks/0lmcu8et6bg_5.js","revision":"01981cc9fadeee7b89095caf492600d5"},{"url":"/_next/static/chunks/0l7lrany~ekp-.js","revision":"be1cdea5b11516d6b290f7b3a43c7262"},{"url":"/_next/static/chunks/0iy61elipqbgw.js","revision":"d15ece2d238f5c10273d6eaa5e4d7d71"},{"url":"/_next/static/chunks/0gto23fyh5ltv.js","revision":"0e6269f6f1186299dca3ec83d2091592"},{"url":"/_next/static/chunks/0faw27kymhnpe.js","revision":"1e1292ac9ac37248edd15882c8df7f85"},{"url":"/_next/static/chunks/0bogi3h~9exnu.js","revision":"f7c3ef9b9d7ea67893de6a94417d9796"},{"url":"/_next/static/chunks/0_gl5.7hf5jrh.js","revision":"d6de9e0b4cab29cabe366039cbc7bc98"},{"url":"/_next/static/chunks/09tp0uhm2ga0c.js","revision":"a898eedc1b52315ef296560d114ae3f2"},{"url":"/_next/static/chunks/05rxabbullzvb.css","revision":"5ac8dac7a55d84f753294a0ab69b8b53"},{"url":"/_next/static/chunks/055wnkd1fytzn.js","revision":"8d5b74e5328ea9d249d25d2175c9181a"},{"url":"/_next/static/chunks/05397im3nh_48.js","revision":"0d8af3bdd199b9c63e6194510e49c5f6"},{"url":"/_next/static/chunks/04xerfbns56co.js","revision":"48f8825036f6b9f923c4e31ef70ec1f4"},{"url":"/_next/static/chunks/03~yq9q893hmn.js","revision":"846118c33b2c0e922d7b3a7676f81f6f"},{"url":"/_next/static/chunks/027njt466~rc..js","revision":"2e12934dd0d2e6a7fdeceb0fc55968cd"},{"url":"/_next/static/chunks/0.~xvorfbljlo.js","revision":"07be6c84403dd15e2ef25294f793b138"},{"url":"/_next/static/chunks/0-y2_2v5drwr6.js","revision":"bfae5f3de88f1c54782735b3ad7a11dc"},{"url":"/_next/static/chunks/0-iml~iiffhcc.js","revision":"11828c0211abd5f6b64a8ed3e6bcb618"},{"url":"/_next/static/chunks/0-3iqzxubq0uh.js","revision":"cb764d6ee7581b68d7094ce21170c422"},{"url":"/_next/static/O7W8Xf2pWcCPM2hTJ8aMr/_ssgManifest.js","revision":"b404e23d62d95bafd03ad7747cc0e88b"},{"url":"/_next/static/O7W8Xf2pWcCPM2hTJ8aMr/_clientMiddlewareManifest.js","revision":"013eb57bab04ab886e7d6f5105a343c8"},{"url":"/_next/static/O7W8Xf2pWcCPM2hTJ8aMr/_buildManifest.js","revision":"3f290ecb505664f59e6ec20e14f7fccd"}],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request }) => request.destination === "image",
      handler: new CacheFirst({
        cacheName: "images",
        plugins: [
          new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        ],
      }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    {
      matcher: ({ request, url }) =>
        request.destination === "document" || url.pathname.startsWith("/resources"),
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 5,
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 })],
      }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({ cacheName: "api", networkTimeoutSeconds: 5 }),
    },
    {
      matcher: ({ request }) =>
        ["style", "script", "worker", "font"].includes(request.destination),
      handler: new StaleWhileRevalidate({ cacheName: "assets" }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
