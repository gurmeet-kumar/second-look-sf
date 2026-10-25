declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SCRAPECREATORS_API_KEY?: string;
    GROQ_API_KEY?: string;
    GROQ_MODEL?: string;
    RESEND_API_KEY?: string;
    DEMO_EMAIL?: string;
    APP_WORKER_SECRET?: string;
    APP_BASE_URL?: string;
  }
}
