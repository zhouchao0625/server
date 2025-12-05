import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

const isDevelopment = process.env.NODE_ENV === 'development';

// Custom handler for rate limit errors that returns JSON
// This format can be intercepted on the frontend with:
// error.data?.code === 'TOO_MANY_REQUESTS' || error.data?.httpStatus === 429
const rateLimitHandler = (req: Request, res: Response) => {
  // Return JSON structure that can be intercepted on frontend with:
  // error.data?.code === 'TOO_MANY_REQUESTS' || error.data?.httpStatus === 429
  // When tRPC wraps this, the response body becomes error.data, so we put code/httpStatus at top level
  res.status(429).json({
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many requests, please try again later.',
  });
};

// General API rate limiter - applies to all routes
export const generalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: rateLimitHandler,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

// Stricter rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: rateLimitHandler,
});

// File upload rate limiter
export const uploadLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 50, // Limit each IP to 50 uploads per hour
  message: 'Too many file uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Helmet configuration
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for tRPC panel
      // Allow inline scripts only in development (for tRPC panel)
      // In production, keep strict CSP without unsafe-inline
      scriptSrc: isDevelopment 
        ? ["'self'", "'unsafe-inline'"] 
        : ["'self'"],
      imgSrc: ["'self'", "data:", "https:"], // Allow images from any HTTPS source
      connectSrc: ["'self'", "https://*.sentry.io"], // Allow Sentry connections
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable if you need to embed resources
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
});