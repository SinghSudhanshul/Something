import { FastifyRequest, FastifyReply } from 'fastify';
import { VerificationService } from './verification.service.js';

const service = new VerificationService();

export class VerificationController {
  async verifyStudentID(req: FastifyRequest, reply: FastifyReply) {
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ code: 'BAD_REQUEST', message: 'No file uploaded' });
    }

    if (!['image/jpeg', 'image/png'].includes(data.mimetype)) {
      return reply.status(400).send({ code: 'BAD_REQUEST', message: 'Only JPEG/PNG allowed' });
    }

    const fileBuffer = await data.toBuffer();
    if (fileBuffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ code: 'FILE_TOO_LARGE', message: 'Max file size is 5MB' });
    }

    const ext = data.mimetype === 'image/png' ? 'png' : 'jpg';
    // @ts-expect-error user is populated by auth middleware
    const userId = req.user.id;
    // @ts-expect-error user is populated by auth middleware
    const campusId = req.user.campusId;

    try {
      const result = await service.processStudentID(userId, campusId, fileBuffer, data.mimetype, ext);
      
      if (result.status === 'manual_review') {
        return reply.status(202).send(result);
      }
      return reply.status(200).send(result);
    } catch (error: any) {
      if (error.statusCode) {
        return reply.status(error.statusCode).send(error);
      }
      throw error;
    }
  }

  async verifyPhone(req: FastifyRequest<{ Body: { phone: string } }>, reply: FastifyReply) {
    // @ts-expect-error user is populated by auth middleware
    const userId = req.user.id;
    const { phone } = req.body;

    try {
      const result = await service.sendPhoneOTP(userId, phone);
      return reply.status(200).send(result);
    } catch (error: any) {
      if (error.statusCode) {
        return reply.status(error.statusCode).send(error);
      }
      throw error;
    }
  }

  async verifyPhoneConfirm(
    req: FastifyRequest<{ Body: { phone: string; otp: string } }>,
    reply: FastifyReply
  ) {
    // @ts-expect-error user is populated by auth middleware
    const userId = req.user.id;
    const { phone, otp } = req.body;

    try {
      const result = await service.verifyPhoneOTP(userId, phone, otp);
      return reply.status(200).send(result);
    } catch (error: any) {
      if (error.statusCode) {
        return reply.status(error.statusCode).send(error);
      }
      throw error;
    }
  }

  async getStatus(req: FastifyRequest, reply: FastifyReply) {
    // @ts-expect-error user is populated by auth middleware
    const userId = req.user.id;
    const result = await service.getStatus(userId);
    return reply.status(200).send(result);
  }
}
