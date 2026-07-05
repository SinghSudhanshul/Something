/**
 * NEXUS Feast — FSSAI Validation Service
 *
 * In production: hits FOSCOS API. In dev: returns mock.
 * Timeout fallback: marks for manual verification.
 */

import axios from 'axios';
import { createLogger } from '@nexus/utils';

const logger = createLogger('feast:fssai-service');

export interface FSSAIResult {
  isValid: boolean;
  expiryDate: string | null;
  businessName: string | null;
  licenseType: string | null;
  requiresManualVerification?: boolean;
}

export async function validateFSSAI(
  licenseNo: string,
  nodeEnv: string,
  foscosApiUrl: string | null,
): Promise<FSSAIResult> {
  // Development/test mode: return mock
  if (nodeEnv !== 'production' || !foscosApiUrl) {
    await new Promise((r) => setTimeout(r, 100)); // Simulate latency
    return {
      isValid: true,
      expiryDate: '2026-12-31',
      businessName: `Mock Business ${licenseNo.slice(-4)}`,
      licenseType: 'State',
    };
  }

  // Production mode: hit FOSCOS API
  try {
    const response = await axios.post(
      `${foscosApiUrl}/api/licenseInfo`,
      { licenseNo },
      { timeout: 5000 },
    );

    const data = response.data as Record<string, unknown>;
    return {
      isValid: data.status === 'active',
      expiryDate: (data.expiryDate as string) ?? null,
      businessName: (data.businessName as string) ?? null,
      licenseType: (data.licenseType as string) ?? null,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      logger.warn({ licenseNo }, 'FOSCOS API timeout — marking for manual verification');
      return {
        isValid: true,
        expiryDate: null,
        businessName: null,
        licenseType: null,
        requiresManualVerification: true,
      };
    }

    logger.error({ err: error, licenseNo }, 'FOSCOS API error');
    return {
      isValid: true,
      expiryDate: null,
      businessName: null,
      licenseType: null,
      requiresManualVerification: true,
    };
  }
}
