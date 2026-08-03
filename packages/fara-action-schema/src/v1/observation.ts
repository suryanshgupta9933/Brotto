import { z } from 'zod';
import {
  ArtifactIdSchema,
  FrameIdSchema,
  ObservationIdSchema,
  SemanticTargetIdSchema,
  TabIdSchema,
} from './ids';

export const FORBIDDEN_BROWSER_DATA_KEYS = new Set([
  'cookie', 'cookies', 'authorization', 'proxy-authorization',
  'localstorage', 'sessionstorage', 'password', 'credentials', 'profile',
]);

const normalizedForbiddenKeys = new Set(
  [...FORBIDDEN_BROWSER_DATA_KEYS].map(normalizeBrowserDataKey),
);

export class ForbiddenBrowserDataError extends Error {
  constructor(public readonly keyPath: string) {
    super(`Forbidden browser data key at ${keyPath}`);
    this.name = 'ForbiddenBrowserDataError';
  }
}

function normalizeBrowserDataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isForbiddenBrowserDataKey(key: string): boolean {
  const normalized = normalizeBrowserDataKey(key);
  return [...normalizedForbiddenKeys].some((forbidden) => normalized.includes(forbidden));
}

export function isHttpUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Rejects browser-secret shaped keys anywhere in a value before serialization. */
export function assertNoForbiddenBrowserData(value: unknown): void {
  const visited = new Set<unknown>();

  const visit = (current: unknown, path: string): void => {
    if (current === null || typeof current !== 'object') return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      const keyPath = `${path}.${key}`;
      if (isForbiddenBrowserDataKey(key)) {
        throw new ForbiddenBrowserDataError(keyPath);
      }
      visit(nestedValue, keyPath);
    }
  };

  visit(value, '$');
}

function withForbiddenBrowserDataGuard<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, context) => {
    try {
      assertNoForbiddenBrowserData(value);
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: error.message,
          path: error.keyPath.slice(2).split('.').filter(Boolean),
        });
        return;
      }
      throw error;
    }
  });
}

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const sensitiveSemanticContent = /(?:authorization|cookie|credential|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token|value\s*=)/i;

function isSafeSemanticContent(value: string): boolean {
  return !sensitiveSemanticContent.test(value);
}

const SafeSemanticTextSchema = z.string().min(1).max(512).refine(
  isSafeSemanticContent,
  'Semantic content may not include sensitive browser data',
);

const SafeSemanticAttributesSchema = z.object({
  'aria-label': SafeSemanticTextSchema.optional(),
  'aria-describedby': SafeSemanticTextSchema.optional(),
  'aria-controls': SafeSemanticTextSchema.optional(),
  'aria-expanded': z.enum(['true', 'false']).optional(),
  'aria-haspopup': z.enum(['true', 'false', 'menu', 'listbox', 'tree', 'grid', 'dialog']).optional(),
  'aria-current': z.enum(['true', 'false', 'page', 'step', 'location', 'date', 'time']).optional(),
  'aria-pressed': z.enum(['true', 'false', 'mixed']).optional(),
  'aria-selected': z.enum(['true', 'false']).optional(),
}).strict();

export const ScreenshotSchema = withForbiddenBrowserDataGuard(z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inline'),
    encoding: z.enum(['base64', 'png', 'jpeg', 'webp']),
    data: z.string().min(1).max(10_000_000),
    sha256: Sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal('artifact'),
    artifactId: ArtifactIdSchema,
    sha256: Sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    encoding: z.enum(['png', 'jpeg', 'webp']),
  }).strict(),
]));

export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  devicePixelRatio: z.number().positive().max(8),
  zoom: z.number().positive().max(8),
  scrollX: z.number().finite(),
  scrollY: z.number().finite(),
}).strict();

export const PageStateSchema = z.object({
  tabId: TabIdSchema,
  frameId: FrameIdSchema,
  lifecycle: z.enum(['loading', 'interactive', 'complete', 'frozen']),
  visibility: z.enum(['visible', 'hidden', 'prerender']),
}).strict();

export const BoundingBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
}).strict();

export const SemanticTargetSchema = withForbiddenBrowserDataGuard(z.object({
  targetId: SemanticTargetIdSchema,
  tag: z.string().min(1).max(64),
  role: z.string().min(1).max(128).optional(),
  accessibleName: z.string().max(512).optional(),
  attributes: SafeSemanticAttributesSchema.optional(),
  boundingBox: BoundingBoxSchema,
  visible: z.boolean(),
  framePath: z.array(z.string().max(128)).max(20),
  shadowPath: z.array(z.string().max(128)).max(20).optional(),
  locatorCandidates: z.array(SafeSemanticTextSchema).max(10),
}).strict());

export const ObservationV1Schema = withForbiddenBrowserDataGuard(z.object({
  observationId: ObservationIdSchema,
  capturedAt: z.string().datetime(),
  url: z.string().url().refine(isHttpUrl, 'Only HTTP(S) observation URLs are allowed'),
  title: z.string().max(512),
  screenshot: ScreenshotSchema,
  viewport: ViewportSchema,
  page: PageStateSchema,
  semanticTargets: z.array(SemanticTargetSchema).max(200),
}).strict());

export type Screenshot = z.infer<typeof ScreenshotSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type PageState = z.infer<typeof PageStateSchema>;
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type SemanticTarget = z.infer<typeof SemanticTargetSchema>;
export type ObservationV1 = z.infer<typeof ObservationV1Schema>;
