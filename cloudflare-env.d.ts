declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MYBOX_TOKEN_ENCRYPTION_KEY?: string;
  }
}
