/**
 * NEXUS Swift — QuickGigs Service
 */

import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createWalletClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';

import { GigRepository, type GigRecord, type GigApplicationRecord } from './gig.repository.js';
import type { CreateGigInput, UpdateGigInput, GigQueryInput, CreateApplicationInput } from './gig.schema.js';

const logger = createLogger('swift:gig-service');

const DEFAULT_EXPIRY_DAYS = 30;

export class GigService {
  private readonly repo: GigRepository;
  private readonly walletClient;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new GigRepository(fastify);
    const secret = process.env['INTERNAL_SERVICE_SECRET'] ?? '';
    this.walletClient = createWalletClient(process.env['WALLET_SERVICE_URL'], secret);
  }

  async createGig(posterId: string, campusId: string, data: CreateGigInput): Promise<GigRecord> {
    // Verify wallet has sufficient balance
    const balance = await this.walletClient.getWalletBalance(posterId);
    if (Number(balance.available) < data.budgetInPaise / 100) {
      throw new AppError(402, 'INSUFFICIENT_BALANCE', 'Insufficient wallet balance to create gig');
    }

    const expiresAt = data.expiresAt
      ? new Date(data.expiresAt)
      : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    if (expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      throw AppError.badRequest('Gig must be open for at least 24 hours');
    }

    if (data.milestones) {
      const totalMilestoneAmount = data.milestones.reduce((sum, m) => sum + m.amountInPaise, 0);
      if (totalMilestoneAmount > data.budgetInPaise) {
        throw AppError.badRequest('Sum of milestone amounts cannot exceed gig budget');
      }
    }

    const gig = await this.repo.create(
      {
        posterId,
        campusId,
        title: data.title,
        description: data.description,
        category: data.category,
        skillsRequired: data.skillsRequired,
        budgetInPaise: data.budgetInPaise,
        durationDays: data.durationDays,
        maxApplicants: data.maxApplicants,
        tags: data.tags,
        attachments: data.attachments,
        expiresAt,
      },
      data.milestones?.map(m => ({
        title: m.title,
        amountInPaise: m.amountInPaise,
        orderIndex: m.orderIndex,
        ...(m.description !== undefined && { description: m.description }),
        ...(m.dueDate !== undefined && { dueDate: new Date(m.dueDate) })
      })) as any,
    );

    this.publishEvent(KafkaTopics.GIG_CREATED, { gigId: gig.id, posterId, campusId, category: gig.category, budget: gig.budgetInPaise }).catch(() => {});
    return gig;
  }

  async updateGig(gigId: string, userId: string, data: UpdateGigInput): Promise<GigRecord> {
    const gig = await this.repo.findById(gigId);
    if (!gig) throw AppError.notFound('Gig not found');
    if (gig.posterId !== userId) throw AppError.forbidden('You can only update your own gigs');
    if (gig.status !== 'open') throw AppError.conflict('Only open gigs can be updated');

    const updated = await this.repo.update(gigId, data as any);
    if (!updated) throw AppError.notFound('Gig not found');
    this.publishEvent(KafkaTopics.GIG_UPDATED, { gigId, userId }).catch(() => {});
    return updated;
  }

  async getGig(gigId: string): Promise<{ gig: GigRecord; milestones: any[] }> {
    const result = await this.repo.findByIdWithDetails(gigId);
    if (!result) throw AppError.notFound('Gig not found');
    // increment view count (fire-and-forget)
    this.repo
      .update(gigId, { viewCount: ((result.gig as any).viewCount ?? 0) + 1 } as any)
      .catch(() => {});
    return result;
  }

  async searchGigs(query: GigQueryInput, campusId: string) {
    return this.repo.findMany(
      {
        campusId,
        ...(query.category !== undefined && { category: query.category }),
        ...(query.skills !== undefined && { skills: query.skills }),
        ...(query.minBudget !== undefined && { minBudget: query.minBudget }),
        ...(query.maxBudget !== undefined && { maxBudget: query.maxBudget }),
        ...(query.status !== undefined && { status: query.status }),
        ...(query.q !== undefined && { q: query.q }),
      },
      { limit: query.limit, sort: query.sort, ...(query.cursor !== undefined && { cursor: query.cursor }) },
    );
  }

  async applyForGig(gigId: string, applicantId: string, data: CreateApplicationInput): Promise<GigApplicationRecord> {
    const gig = await this.repo.findById(gigId);
    if (!gig) throw AppError.notFound('Gig not found');
    if (gig.status !== 'open') throw AppError.conflict('Gig is no longer open');
    if (gig.posterId === applicantId) throw AppError.forbidden('Cannot apply to your own gig');
    if (gig.applicantCount >= gig.maxApplicants) {
      throw AppError.conflict('Gig has reached maximum applicants');
    }

    const existing = await this.repo.findApplicationByGigAndApplicant(gigId, applicantId);
    if (existing) throw AppError.conflict('You have already applied for this gig');

    // check trust score
    const userData = await this.fastify.db.execute({
      text: `SELECT trust_score FROM student_profiles WHERE user_id = $1`,
      values: [applicantId],
    } as any);
    const trustScore = Number(((userData as any)[0] as any)?.trust_score ?? 0);
    if (trustScore < 2.5) {
      throw AppError.forbidden('Trust score must be at least 2.50 to apply for gigs');
    }

    const application = await this.repo.createApplication({
      gigId,
      applicantId,
      proposal: data.proposal,
      ...(data.proposedRateInPaise !== undefined && { proposedRateInPaise: data.proposedRateInPaise }),
      ...(data.estimatedDays !== undefined && { estimatedDays: data.estimatedDays }),
    } as any);

    this.publishEvent(KafkaTopics.GIG_APPLICATION_RECEIVED, { gigId, applicantId }).catch(() => {});
    return application;
  }

  async getApplicationsForGig(gigId: string, requesterId: string): Promise<GigApplicationRecord[]> {
    const gig = await this.repo.findById(gigId);
    if (!gig) throw AppError.notFound('Gig not found');
    if (gig.posterId !== requesterId) throw AppError.forbidden('Only the poster can view applications');
    return this.repo.findApplicationsByGig(gigId);
  }

  async respondToApplication(
    gigId: string,
    applicationId: string,
    posterId: string,
    action: 'accepted' | 'rejected',
  ): Promise<void> {
    const gig = await this.repo.findById(gigId);
    if (!gig) throw AppError.notFound('Gig not found');
    if (gig.posterId !== posterId) throw AppError.forbidden('Only the poster can respond');
    if (gig.status !== 'open') throw AppError.conflict('Gig is not open');

    const application = await this.repo.findApplicationById(applicationId);
    if (!application) throw AppError.notFound('Application not found');
    if (application.gigId !== gigId) throw AppError.badRequest('Application does not belong to this gig');
    if (application.status !== 'pending') throw AppError.conflict('Application is no longer pending');

    await this.repo.updateApplicationStatus(applicationId, action);

    if (action === 'accepted') {
      // Lock funds in escrow
      const txn = await this.walletClient.createTransaction({
        buyerId: posterId,
        sellerId: application.applicantId,
        amount: String(gig.budgetInPaise / 100),
        module: 'swift',
        referenceId: gigId,
        referenceType: 'gig',
        description: `Gig: ${gig.title}`,
      });
      await this.walletClient.initiateEscrow(txn.transactionId);

      await this.repo.update(gigId, {
        status: 'in_progress',
        completedAt: null,
      });
      await this.repo.rejectAllPendingApplications(gigId, applicationId);

      this.publishEvent(KafkaTopics.GIG_RUNNER_ACCEPTED, { gigId, applicantId: application.applicantId }).catch(() => {});
    } else {
      this.publishEvent(KafkaTopics.GIG_APPLICATION_REJECTED, { gigId, applicantId: application.applicantId }).catch(() => {});
    }
  }

  async getMyPostedGigs(posterId: string, status?: string) {
    return this.repo.findByPoster(posterId, status);
  }

  async getMyApplications(applicantId: string) {
    return this.repo.findByApplicant(applicantId);
  }

  async getRecommendedGigsForUser(campusId: string, userId: string, limit = 20) {
    // Get user's skills from student profile
    const profileResult = await this.fastify.db.execute({
      text: `SELECT interests FROM student_profiles WHERE user_id = $1`,
      values: [userId],
    } as any);
    const interests = (((profileResult as any)[0] as any)?.interests as string[]) ?? [];
    return this.repo.findOpenGigsForUser(campusId, interests, limit);
  }

  async bookmarkGig(gigId: string, userId: string): Promise<void> {
    const gig = await this.repo.findById(gigId);
    if (!gig) throw AppError.notFound('Gig not found');
    await this.repo.addBookmark(gigId, userId);
  }

  async unbookmarkGig(gigId: string, userId: string): Promise<void> {
    await this.repo.removeBookmark(gigId, userId);
  }

  async getMyBookmarks(userId: string, limit = 20, cursor?: string) {
    return this.repo.findBookmarksByUser(userId, limit, cursor);
  }

  async autoExpire(): Promise<number> {
    const expired = await this.repo.findExpiredOpenGigs();
    let count = 0;
    for (const gig of expired) {
      try {
        await this.repo.update(gig.id, { status: 'expired' });
        this.publishEvent(KafkaTopics.GIG_EXPIRED, { gigId: gig.id }).catch(() => {});
        count++;
      } catch (err) {
        logger.error({ err, gigId: gig.id }, 'Failed to expire gig');
      }
    }
    return count;
  }

  private async publishEvent(topic: string, data: unknown) {
    const producer = this.fastify.kafka?.producer;
    if (producer) await publishEvent(producer, topic as any, data);
  }
}
