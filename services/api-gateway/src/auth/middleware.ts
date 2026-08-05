import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { getEnv } from '../db/index.js';
import type { User, Organization, JWTPayload } from '../types/index.js';
import { query, transaction } from '../db/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  organization: Organization;
}

// JWKS cache TTL in milliseconds (default: 1 hour)
const JWKS_CACHE_TTL_MS = parseInt(process.env.JWKS_CACHE_TTL_MS ?? '3600000', 10);

// OIDC JWKS cache with TTL-based refresh
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTimestamp = 0;

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  const now = Date.now();
  if (!jwks || now - jwksCacheTimestamp > JWKS_CACHE_TTL_MS) {
    const config = getEnv();
    const issuer = config.OIDC_ISSUER;
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      jwksCacheParameters: {
        age: JWKS_CACHE_TTL_MS,
        holdAge: JWKS_CACHE_TTL_MS * 2, // Allow extra time for in-flight requests
      },
    });
    jwksCacheTimestamp = now;
  }
  return jwks;
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const config = getEnv();

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE || config.OIDC_CLIENT_ID,
    });

    return payload as unknown as JWTPayload;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
    throw error;
  }
}

export async function getUserFromToken(payload: JWTPayload): Promise<User | null> {
  interface UserRow {
    id: string;
    email: string;
    name: string;
    organization_id: string;
    created_at: Date;
    updated_at: Date;
  }

  const result = await query<UserRow>(
    `SELECT u.id, u.email, u.name, u.organization_id,
            o.id as org_id, o.name as org_name, o.plan as org_plan,
            u.created_at, u.updated_at
     FROM users u
     JOIN organizations o ON u.organization_id = o.id
     WHERE u.oidc_subject = $1`,
    [payload.sub]
  );

  if (!result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    organizationId: row.organization_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const result = await query<Organization>(
    'SELECT id, name, plan, created_at, updated_at FROM organizations WHERE id = $1',
    [orgId]
  );

  return result.rows[0] || null;
}

// Fastify authentication hook
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header',
      statusCode: 401,
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyToken(token);
    const user = await getUserFromToken(payload);

    if (!user) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'User not found',
        statusCode: 401,
      });
      return;
    }

    const organization = await getOrganization(user.organizationId);

    if (!organization) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Organization not found',
        statusCode: 401,
      });
      return;
    }

    // Attach user to request
    (request as FastifyRequest & { user: AuthenticatedUser }).user = {
      id: user.id,
      email: user.email,
      name: user.name,
      organization,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Authentication error');
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      statusCode: 401,
    });
  }
}

// Optional authentication - doesn't fail if no token provided
export async function optionalAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return;
  }

  await authenticate(request, reply);
}

// Device authentication for connector/extension
export async function authenticateDevice(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const deviceToken = request.headers['x-device-token'];

  if (!deviceToken || typeof deviceToken !== 'string') {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing device token',
      statusCode: 401,
    });
    return;
  }

  try {
    // Use transaction with row lock to atomically verify token expiry and bind session.
    // This prevents TOCTOU race where token could expire between verification and use.
    const result = await transaction(async (client) => {
      // Lock the device_tokens row to prevent concurrent modifications
      // and re-check expiry within the transaction to ensure atomicity
      const tokenResult = await client.query<{ device_id: string; organization_id: string; user_id: string }>(
        `SELECT d.id as device_id, d.organization_id, d.user_id
         FROM device_tokens dt
         JOIN devices d ON dt.device_id = d.id
         WHERE dt.token = $1 AND dt.expires_at > NOW()
         AND d.status = 'paired'
         FOR UPDATE OF dt`,
        [deviceToken]
      );

      if (!tokenResult.rows[0]) {
        throw new Error('Invalid or expired device token');
      }

      return tokenResult;
    });

    const row = result.rows[0];
    (request as FastifyRequest & { device: { id: string; organizationId: string; userId: string } }).device = {
      id: row.device_id,
      organizationId: row.organization_id,
      userId: row.user_id,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Device authentication error');
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid device token',
      statusCode: 401,
    });
  }
}

// Organization-level authorization
export function requireOrganization(orgId: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { user?: AuthenticatedUser }).user;

    if (!user || user.organization.id !== orgId) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Access denied to this organization',
        statusCode: 403,
      });
    }
  };
}

// Role-based access control
export type Role = 'admin' | 'operator' | 'user';

export function requireRole(role: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { user?: AuthenticatedUser }).user;

    if (!user) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
      return;
    }

    // Check user's role in organization
    const result = await query<{ role: Role }>(
      `SELECT role FROM organization_members
       WHERE user_id = $1 AND organization_id = $2`,
      [user.id, user.organization.id]
    );

    const userRole = result.rows[0]?.role || 'user';

    const roleHierarchy: Record<Role, number> = {
      admin: 3,
      operator: 2,
      user: 1,
    };

    if (roleHierarchy[userRole] < roleHierarchy[role]) {
      reply.code(403).send({
        error: 'Forbidden',
        message: `Required role: ${role}`,
        statusCode: 403,
      });
    }
  };
}

export function registerAuthHooks(app: FastifyInstance): void {
  // Add user property to request
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { user?: AuthenticatedUser }).user = undefined;
    (request as FastifyRequest & { device?: { id: string; organizationId: string; userId: string } }).device = undefined;
  });
}
