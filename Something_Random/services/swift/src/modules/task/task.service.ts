/**
 * NEXUS Swift — Task Service
 *
 * Campus errands: post, apply, accept, complete, verify, auto-expire.
 */

import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createWalletClient, createTrustClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { TaskRepository, type TaskRecord } from './task.repository.js';

const logger = createLogger('swift:task-service');

export class TaskService {
  private readonly repo: TaskRepository;
  private readonly walletClient;
  private readonly trustClient;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new TaskRepository(fastify);
    const secret = process.env['INTERNAL_SERVICE_SECRET'] ?? '';
    this.walletClient = createWalletClient(process.env['WALLET_SERVICE_URL'], secret);
    this.trustClient = createTrustClient(process.env['USER_SERVICE_URL'], secret);
  }

  async postTask(posterId: string, campusId: string, data: { title: string; description?: string | undefined; category: string; reward: number; location_from?: string | undefined; location_to?: string | undefined; deadline_at: string }): Promise<TaskRecord> {
    const deadline = new Date(data.deadline_at);
    if (deadline.getTime() - Date.now() < 30 * 60_000) throw new AppError(422, 'DEADLINE_TOO_SOON', 'Deadline must be at least 30 minutes in the future');
    if (data.reward < 10 || data.reward > 500) throw AppError.badRequest('Reward must be between ₹10 and ₹500');

    // Verify poster has sufficient balance
    const balance = await this.walletClient.getWalletBalance(posterId);
    if (Number(balance.available) < data.reward) throw new AppError(402, 'INSUFFICIENT_BALANCE', 'Insufficient wallet balance for reward');

    const task = await this.repo.create({ 
      poster_id: posterId, 
      campus_id: campusId, 
      title: data.title, 
      category: data.category, 
      reward: String(data.reward), 
      deadline_at: deadline,
      ...(data.description !== undefined && { description: data.description }),
      ...(data.location_from !== undefined && { location_from: data.location_from }),
      ...(data.location_to !== undefined && { location_to: data.location_to }),
    });

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.TASK_CREATED, task).catch(() => {});
    return task;
  }

  async applyForTask(taskId: string, runnerId: string, message?: string) {
    const task = await this.repo.findById(taskId);
    if (!task) throw AppError.notFound('Task not found');
    if (task.status !== 'open') throw AppError.conflict('Task is no longer open');
    if (task.poster_id === runnerId) throw AppError.forbidden('Cannot apply to your own task');

    // Check trust score
    const userData = await this.fastify.db.execute({ text: `SELECT trust_score FROM student_profiles WHERE user_id = $1`, values: [runnerId] } as any);
    const trustScore = Number((userData as any)[0]?.trust_score ?? 0);
    if (trustScore < 2.00) throw AppError.forbidden('Trust score must be at least 2.00 to apply for tasks');

    const existing = await this.repo.findApplicationByTaskAndRunner(taskId, runnerId);
    if (existing) throw AppError.conflict('You have already applied for this task');

    const application = await this.repo.createApplication(taskId, runnerId, message);
    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.TASK_APPLICATION_RECEIVED, { taskId, runnerId }).catch(() => {});
    return application;
  }

  async acceptRunner(taskId: string, posterId: string, runnerId: string) {
    const task = await this.repo.findById(taskId);
    if (!task) throw AppError.notFound('Task not found');
    if (task.poster_id !== posterId) throw AppError.forbidden('Only the poster can accept runners');
    if (task.status !== 'open') throw AppError.conflict('Task is no longer open');

    const app = await this.repo.findApplicationByTaskAndRunner(taskId, runnerId);
    if (!app || app.status !== 'pending') throw AppError.badRequest('No pending application from this runner');

    // Escrow poster's reward
    const txn = await this.walletClient.createTransaction({ buyerId: posterId, sellerId: runnerId, amount: String(task.reward), module: 'swift', referenceId: taskId, referenceType: 'swift_task', description: `Task reward: ${task.title}` });
    await this.walletClient.initiateEscrow(txn.transactionId);

    await this.repo.update(taskId, { status: 'assigned', runner_id: runnerId });
    await this.repo.updateApplicationStatus(app.id, 'accepted');
    await this.repo.rejectAllPendingApplications(taskId, runnerId);

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.TASK_RUNNER_ACCEPTED, { taskId, runnerId, transactionId: txn.transactionId }).catch(() => {});
  }

  async submitCompletion(taskId: string, runnerId: string, proofUrl: string, proofType: string, notes?: string) {
    const task = await this.repo.findById(taskId);
    if (!task) throw AppError.notFound('Task not found');
    if (task.runner_id !== runnerId) throw AppError.forbidden('Only the assigned runner can submit');
    if (!['assigned', 'in_progress'].includes(task.status)) throw AppError.conflict('Task cannot be completed in current state');

    if (proofType === 'text' && (!notes || notes.length < 20)) throw AppError.badRequest('Text proof must be at least 20 characters');

    await this.repo.update(taskId, { 
      status: 'pending_verification', 
      completion_proof_url: proofUrl, 
      completion_proof_type: proofType, 
      ...(notes !== undefined && { runner_notes: notes }),
    });

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.TASK_COMPLETION_SUBMITTED, { taskId, runnerId }).catch(() => {});
  }

  async verifyCompletion(taskId: string, posterId: string, approve: boolean) {
    const task = await this.repo.findById(taskId);
    if (!task) throw AppError.notFound('Task not found');
    if (task.poster_id !== posterId) throw AppError.forbidden('Only the poster can verify');
    if (task.status !== 'pending_verification') throw AppError.conflict('Task is not pending verification');

    if (approve) {
      // Find transaction and release escrow
      await this.repo.update(taskId, { status: 'completed' });
      // Trust events
      this.trustClient.recordTrustEvents([
        { userId: task.runner_id!, eventType: 'gig_completed', referenceId: taskId, referenceType: 'swift_task' },
        { userId: posterId, eventType: 'transaction_completed', referenceId: taskId, referenceType: 'swift_task' },
      ]).catch(() => {});

      const producer = this.fastify.kafka?.producer;
      if (producer) publishEvent(producer, KafkaTopics.TASK_COMPLETED, { taskId }).catch(() => {});
    } else {
      const newRejectCount = task.rejection_count + 1;
      if (newRejectCount >= 2) {
        await this.repo.update(taskId, { status: 'disputed', rejection_count: newRejectCount });
        const producer = this.fastify.kafka?.producer;
        if (producer) publishEvent(producer, KafkaTopics.TASK_DISPUTED, { taskId }).catch(() => {});
      } else {
        await this.repo.update(taskId, { status: 'in_progress', rejection_count: newRejectCount });
        const producer = this.fastify.kafka?.producer;
        if (producer) publishEvent(producer, KafkaTopics.TASK_COMPLETION_REJECTED, { taskId }).catch(() => {});
      }
    }
  }

  async autoExpire(): Promise<number> {
    const expired = await this.repo.findExpiredTasks();
    let count = 0;
    for (const task of expired) {
      try {
        if (['assigned', 'in_progress'].includes(task.status)) {
          // Has escrow — refund
          try { await this.walletClient.refundEscrow(task.id); } catch (e) { logger.error({ err: e, taskId: task.id }, 'Failed to refund expired task escrow'); }
        }
        await this.repo.update(task.id, { status: 'cancelled' });
        const producer = this.fastify.kafka?.producer;
        if (producer) publishEvent(producer, KafkaTopics.TASK_EXPIRED, { taskId: task.id }).catch(() => {});
        count++;
      } catch (err) { logger.error({ err, taskId: task.id }, 'Failed to expire task'); }
    }
    return count;
  }

  async getTasks(campusId: string) { return this.repo.findByCampus(campusId); }
  async getTask(id: string) { const t = await this.repo.findById(id); if (!t) throw AppError.notFound('Task not found'); return t; }
  async getApplications(taskId: string, posterId: string) {
    const task = await this.repo.findById(taskId); if (!task || task.poster_id !== posterId) throw AppError.forbidden('Not authorized');
    return this.repo.findApplicationsByTask(taskId);
  }
  async getMyPostedTasks(posterId: string) { return this.repo.findByPoster(posterId); }
  async getMyRunningTasks(runnerId: string) { return this.repo.findByRunner(runnerId); }
  async rateTask(taskId: string, raterId: string, score: number, reviewText?: string) {
    const task = await this.repo.findById(taskId); if (!task) throw AppError.notFound('Task not found');
    if (task.status !== 'completed') throw AppError.badRequest('Task must be completed to rate');
    const rateeId = raterId === task.poster_id ? task.runner_id! : task.poster_id;
    await this.repo.createRating(taskId, raterId, rateeId, score, reviewText);
  }
}
