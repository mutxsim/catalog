import "server-only";

function required(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  throw new Error(`Missing environment variable ${name}. See README → Setup.`);
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Secret used to hash client IPs for rate limiting. */
  get hashSecret() {
    return optional("ORDER_HASH_SECRET") ?? this.supabaseSecretKey;
  },
  get orderRateLimit() {
    return Number(optional("ORDER_RATE_LIMIT") ?? 10);
  },
  get orderRateWindowMinutes() {
    return Number(optional("ORDER_RATE_WINDOW_MINUTES") ?? 10);
  },
  whatsapp: {
    get accessToken() {
      return optional("WHATSAPP_ACCESS_TOKEN");
    },
    get phoneNumberId() {
      return optional("WHATSAPP_PHONE_NUMBER_ID");
    },
    /** Override only for testing against a mock server. */
    get graphUrl() {
      return (optional("WHATSAPP_GRAPH_URL") ?? "https://graph.facebook.com").replace(/\/$/, "");
    },
    get apiVersion() {
      return optional("WHATSAPP_API_VERSION") ?? "v26.0";
    },
    get templateName() {
      return optional("WHATSAPP_TEMPLATE_NAME");
    },
    get templateLanguage() {
      return optional("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en_US";
    },
    get appSecret() {
      return optional("WHATSAPP_APP_SECRET");
    },
    get webhookVerifyToken() {
      return optional("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    },
    get configured() {
      return Boolean(this.accessToken && this.phoneNumberId);
    },
  },
};
