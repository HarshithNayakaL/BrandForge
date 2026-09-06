import { z } from 'zod';
import { QAResultSchema } from './qa.js';
import { GenerationAttemptSchema, ShotContractSchema } from './campaign.js';

export const RUN_STATUSES = [
  'CREATED', 'VALIDATING', 'CRAWLING', 'BRAND_ANALYSIS', 'PRODUCT_ANALYSIS',
  'PLANNING', 'GENERATING', 'QA', 'REPAIRING', 'FINALIZING',
  'COMPLETED', 'PARTIAL', 'FAILED',
];

export const FAILURE_CODES = [
  'INVALID_URL', 'CRAWL_FAILED', 'CRAWL_TIMEOUT', 'INSUFFICIENT_BRAND_EVIDENCE',
  'INVALID_PRODUCT_IMAGE', 'BRAND_ANALYSIS_FAILED', 'PRODUCT_ANALYSIS_FAILED',
  'CAMPAIGN_PLANNING_FAILED', 'GENERATION_TIMEOUT', 'GENERATION_FAILED',
  'RATE_LIMITED', 'QA_FAILED', 'REPAIR_FAILED', 'MAX_REPAIR_ATTEMPTS',
  'PARTIAL_CAMPAIGN_FAILURE', 'SYSTEM_ERROR',
];

export const ShotManifestSchema = z.object({
  shot_id: z.string(),
  purpose: z.string(),
  status: z.enum(['ACCEPTED', 'BLOCKED', 'FAILED']),
  contract: ShotContractSchema,
  generation_attempts: z.array(GenerationAttemptSchema),
  repair_attempts: z.number().int().min(0),
  output: z.string().nullable(),
  qa: QAResultSchema.nullable(),
  qa_history: z.array(QAResultSchema).default([]),
  failure_reason: z.string().nullable().default(null),
});

export const ManifestSchema = z.object({
  run_id: z.string(),
  workflow_version: z.string(),
  brand_profile_version: z.string(),
  brand: z.string(),
  brand_url: z.string(),
  brand_id: z.string(),
  product_category: z.string(),
  product_asset_id: z.string(),
  models: z.object({
    brand_intelligence: z.string(),
    product_intelligence: z.string(),
    planner: z.string(),
    image: z.string(),
    qa: z.string(),
  }),
  timestamps: z.object({
    created_at: z.string(),
    completed_at: z.string().nullable(),
  }),
  usage: z.object({
    image_generations: z.number(),
    repairs: z.number(),
    gemini_calls: z.number(),
    crawl_pages: z.number(),
  }),
  status: z.enum(['COMPLETED', 'PARTIAL', 'FAILED']),
  accepted: z.number(),
  blocked: z.number(),
  shots: z.array(ShotManifestSchema),
  errors: z.array(z.object({ code: z.string(), message: z.string(), at: z.string() })).default([]),
});
