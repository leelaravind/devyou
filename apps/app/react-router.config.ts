import type { Config } from "@react-router/dev/config";

/**
 * SSR is mandatory here, and not merely because the Cloudflare Vite plugin has no
 * SPA mode. Plan §16 requires public troubleshooting knowledge to be present in
 * server-rendered HTML, and the Phase 12 gate tests it: "no core page depends on
 * client JS for crawlable knowledge."
 */
export default {
  ssr: true,
} satisfies Config;
