import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler.js';
import { logger } from '../utils/logger.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    campusId: string;
    role: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 401, 'No access token provided');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError('UNAUTHORIZED', 401, 'No access token provided in header');
    }

    const parts = token.split('.');
    if (parts.length < 2) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid token format');
    }

    // TODO: Verify JWT
    const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64').toString());

    req.user = {
      userId: payload.sub,
      campusId: payload.campus_id,
      role: payload.role,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('UNAUTHORIZED', 401, 'Invalid or expired access token'));
    }
  }
};

logger.info('Auth middleware initialized');
