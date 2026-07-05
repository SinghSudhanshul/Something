import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { VerificationController } from './verification.controller.js';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';

const controller = new VerificationController();

export const verificationRoutes: FastifyPluginAsyncZod = async (fastify: any) => {
  // We need multipart support for file uploads
  // Note: @fastify/multipart should be registered in the main index.ts

  fastify.post(
    '/student-id',
    {
      preHandler: [requireAuth(), requireVerificationLevel(1)],
      schema: {
        description: 'Upload and verify student ID card',
        tags: ['Verification'],
        consumes: ['multipart/form-data'],
        response: {
          200: z.object({
            verification_level: z.number(),
            message: z.string(),
          }),
          202: z.object({
            status: z.string(),
            message: z.string(),
            estimated_time: z.string(),
          }),
        },
      },
    },
    controller.verifyStudentID.bind(controller) as any
  );

  fastify.post(
    '/phone',
    {
      preHandler: [requireAuth(), requireVerificationLevel(1)],
      schema: {
        description: 'Send OTP for phone verification',
        tags: ['Verification'],
        body: z.object({
          phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)'),
        }),
        response: {
          200: z.object({
            message: z.string(),
            expires_in: z.number(),
            dev_otp: z.string().optional(),
          }),
        },
      },
    },
    controller.verifyPhone.bind(controller) as any
  );

  fastify.post(
    '/phone/confirm',
    {
      preHandler: [requireAuth()],
      schema: {
        description: 'Confirm phone OTP',
        tags: ['Verification'],
        body: z.object({
          phone: z.string().regex(/^\+91[6-9]\d{9}$/),
          otp: z.string().length(6),
        }),
        response: {
          200: z.object({
            message: z.string(),
            access_token: z.string().optional(),
          }),
        },
      },
    },
    controller.verifyPhoneConfirm.bind(controller) as any
  );

  fastify.get(
    '/status',
    {
      preHandler: [requireAuth()],
      schema: {
        description: 'Get current verification status and next steps',
        tags: ['Verification'],
        response: {
          200: z.object({
            email_verified: z.boolean(),
            phone_verified: z.boolean(),
            verification_level: z.number(),
            pending_verifications: z.array(
              z.object({
                type: z.string(),
                status: z.string(),
                created_at: z.date(),
              })
            ),
            next_step: z.string(),
          }),
        },
      },
    },
    controller.getStatus.bind(controller) as any
  );
};
