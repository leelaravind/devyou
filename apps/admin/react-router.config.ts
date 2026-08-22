import type { Config } from "@react-router/dev/config";

/**
 * SSR, like the public Worker — but for the opposite reason.
 *
 * There, server rendering exists so knowledge is crawlable. Here nothing is crawlable
 * and nothing should be: every response carries `no-store` and `noindex`. SSR is
 * required because the authorisation decision has to happen on the server before any
 * data is produced. A client-rendered admin would ship the moderation queue to the
 * browser and *then* decide whether the viewer may see it, which is not a control.
 */
export default {
  ssr: true,
} satisfies Config;
