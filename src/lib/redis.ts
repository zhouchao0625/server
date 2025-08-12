// src/lib/redis.ts
import { createClient } from "redis";
import { logger } from "src/logger";

if (!process.env.REDIS_URL) {
  throw new Error(
    "❌ Missing REDIS_URL environment variable for Redis connection."
  );
}

const redis = createClient({
  url: process.env.REDIS_URL,
});

redis.on("error", (err) => {
  logger.error("Redis Client Error:", err);
});

(async () => {
  try {
    if (!redis.isOpen) {
      await redis.connect();
      logger.info("✅ Connected to Redis");
    }
  } catch (err: Error | any) {
    logger.error("❌ Failed to connect to Redis:", err);
    process.exit(1); // Exit app if Redis connection fails
  }
})();

export default redis;
