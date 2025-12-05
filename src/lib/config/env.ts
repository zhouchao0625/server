import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { logger } from '../../utils/logger.js';

// Determine which env file to load based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
const envFileMap: Record<string, string> = {
  test: '.env.test',
  development: '.env.development',
  production: '.env.production',
};

// Load the appropriate env file
const envFile = envFileMap[nodeEnv] || '.env';
const envPath = resolve(process.cwd(), envFile);

// Load environment variables from the correct file
// First load .env (base), then override with environment-specific file
dotenv.config(); // Load .env first (base config)
dotenv.config({ path: envPath, override: true }); // Override with env-specific

const isTest = nodeEnv === 'test';
const isProduction = nodeEnv === 'production';

// Base schema with required vars for all environments
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
});

// Production/development schema with all required vars
const fullSchema = baseSchema.extend({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  BACKEND_URL: z.string().url().default('http://localhost:3001'),
  SENTRY_DSN: z.string().url().optional(),
  EMAIL_HOST: z.string().min(1, 'EMAIL_HOST is required'),
  EMAIL_USER: z.string().email('EMAIL_USER must be a valid email'),
  EMAIL_PASS: z.string().min(1, 'EMAIL_PASS is required'),
  EMAIL_DRY_RUN: z.string().optional().default('false'),
  GOOGLE_CLOUD_PROJECT_ID: z.string().min(1, 'GOOGLE_CLOUD_PROJECT_ID is required'),
  GOOGLE_CLOUD_CLIENT_EMAIL: z.string().email('GOOGLE_CLOUD_CLIENT_EMAIL must be a valid email'),
  GOOGLE_CLOUD_PRIVATE_KEY: z.string().min(1, 'GOOGLE_CLOUD_PRIVATE_KEY is required'),
  GOOGLE_CLOUD_BUCKET_NAME: z.string().min(1, 'GOOGLE_CLOUD_BUCKET_NAME is required'),
  PUSHER_APP_ID: z.string().min(1, 'PUSHER_APP_ID is required'),
  PUSHER_KEY: z.string().min(1, 'PUSHER_KEY is required'),
  PUSHER_SECRET: z.string().min(1, 'PUSHER_SECRET is required'),
  PUSHER_CLUSTER: z.string().min(1, 'PUSHER_CLUSTER is required'),
  INFERENCE_API_KEY: z.string().optional(),
  INFERENCE_API_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LOG_MODE: z.enum(['normal', 'verbose', 'quiet']).default('normal'),
});

// Test schema - only require what's needed for tests
const testSchema = baseSchema.extend({
  NEXT_PUBLIC_APP_URL: z.string().url().optional().default('http://localhost:3000'),
  BACKEND_URL: z.string().url().optional().default('http://localhost:3001'),
  SENTRY_DSN: z.string().url().optional(),
  EMAIL_HOST: z.string().optional().default('smtp.test.com'),
  EMAIL_USER: z.string().email().optional().default('test@test.com'),
  EMAIL_PASS: z.string().optional().default('test'),
  EMAIL_DRY_RUN: z.string().optional().default('false'),
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional().default('test-project'),
  GOOGLE_CLOUD_CLIENT_EMAIL: z.string().email().optional().default('test@test.iam.gserviceaccount.com'),
  GOOGLE_CLOUD_PRIVATE_KEY: z.string().optional().default('test-key'),
  GOOGLE_CLOUD_BUCKET_NAME: z.string().optional().default('test-bucket'),
  PUSHER_APP_ID: z.string().optional().default('test-app-id'),
  PUSHER_KEY: z.string().optional().default('test-key'),
  PUSHER_SECRET: z.string().optional().default('test-secret'),
  PUSHER_CLUSTER: z.string().optional().default('us2'),
  INFERENCE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  INFERENCE_API_BASE_URL: z.string().url().optional(),
  LOG_MODE: z.enum(['normal', 'verbose', 'quiet']).default('quiet'),
});

// Use test schema in test mode, full schema otherwise
const envSchema = isTest ? testSchema : fullSchema;

// Validate environment variables
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    
    // Only exit on validation failure in production
    if (isProduction && !parsed.DATABASE_URL) {
      logger.error('DATABASE_URL is required in production');
      process.exit(1);
    }
    
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message,
      }));
      
      logger.error('Environment variable validation failed', {
        envFile,
        missingVars,
      });
      
      // Only exit in production - in test/dev, log warning but continue
      if (isProduction) {
        logger.error(`Please check your ${envFile} file and ensure all required variables are set.`);
        process.exit(1);
      } else {
        logger.warn('Continuing with defaults - some features may not work correctly', {
          envFile,
        });
        // Return parsed with defaults for non-production
        return envSchema.parse({ ...process.env });
      }
    }
    throw error;
  }
}

// Export validated environment variables
export const env = validateEnv();

// Type-safe environment access
export type Env = z.infer<typeof envSchema>;