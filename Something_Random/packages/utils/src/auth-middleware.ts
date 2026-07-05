import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

export type UserRole =
  | 'student'
  | 'vendor'
  | 'driver'
  | 'moderator'
  | 'campus_admin'
  | 'super_admin';
export type TrustTier = 'new' | 'building' | 'trusted' | 'verified' | 'elite';

export interface RequestUser {
  id: string;
  campusId: string;
  verificationLevel: 1 | 2 | 3 | 4;
  trustTier: TrustTier;
  roles: UserRole[];
}

export function extractUserFromHeaders(headers: Record<string, string | string[] | undefined>): RequestUser | null {
  try {
    const id = headers['x-authenticated-userid'];
    if (!id || typeof id !== 'string') return null;

    const campusId = headers['x-user-campus-id'];
    if (!campusId || typeof campusId !== 'string') return null;

    const verificationLevelStr = headers['x-user-verification-level'];
    const verificationLevel = parseInt(verificationLevelStr as string, 10);
    if (isNaN(verificationLevel) || verificationLevel < 1 || verificationLevel > 4) return null;

    const trustTier = headers['x-user-trust-tier'] as TrustTier || 'new';
    
    let roles: UserRole[] = [];
    const rolesStr = headers['x-user-roles'];
    if (typeof rolesStr === 'string' && rolesStr.length > 0) {
      roles = rolesStr.split(',').map((r) => r.trim() as UserRole);
    } else {
      // Default to student if no roles passed but authenticated
      roles = ['student'];
    }

    return {
      id,
      campusId,
      verificationLevel: verificationLevel as 1 | 2 | 3 | 4,
      trustTier,
      roles,
    };
  } catch (error) {
    return null;
  }
}

export function requireAuth(allowedRoles?: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Check if the service is verifying its own JWT, use that (e.g. fallback when Kong isn't proxying)
    // In our Fastify apps, req.user might be populated by fastify-jwt if applied locally.
    // However, we prioritize Kong headers for microservice identity propagation.
    const user = extractUserFromHeaders(req.headers);
    
    if (!user) {
      // Fallback for local auth testing when Kong is bypassed
      if ((req as any).user) {
        // @ts-ignore
        if ((req as any).user.sub) {
          // @ts-ignore
          (req as any).user.id = (req as any).user.sub;
        }
        return; 
      }
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const hasRole = user.roles.some((role) => allowedRoles.includes(role));
      if (!hasRole) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      }
    }

    // Attach to request
    (req as any).user = user;
  };
}

export function requireVerificationLevel(level: 1 | 2 | 3 | 4) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // @ts-ignore
    const user = req.user as RequestUser;
    
    if (!user || !user.verificationLevel) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    if (user.verificationLevel < level) {
      return reply.status(403).send({
        code: 'VERIFICATION_REQUIRED',
        message: 'Complete identity verification to access this feature',
        required_level: level,
        current_level: user.verificationLevel,
      });
    }
  };
}
