/**
 * NEXUS Skills — Collaboration Service
 *
 * Team formation posts for hackathons, research, startup projects.
 */

import { and, desc, eq, sql, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError, createLogger } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';

import * as schema from '@nexus/database/schema';

const logger = createLogger('skills:collab-service');

export class CollaborationService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.db;
  }

  private async publish(topic: string, data: unknown) {
    const producer = this.fastify.kafka?.producer;
    if (producer) await publishEvent(producer, topic as any, data);
  }

  async createPost(
    authorId: string,
    campusId: string,
    data: {
      title: string;
      description: string;
      projectType: string;
      skillsNeeded: string[];
      teamSize: number;
      commitment?: string | undefined;
      durationWeeks?: number | undefined;
      tags?: string[] | undefined;
    },
  ) {
    const [post] = await this.db
      .insert(schema.collaborationPosts)
      .values({
        authorId,
        campusId,
        title: data.title,
        description: data.description,
        projectType: data.projectType,
        skillsNeeded: data.skillsNeeded,
        teamSize: data.teamSize,
        ...(data.commitment !== undefined && { commitment: data.commitment }),
        ...(data.durationWeeks !== undefined && { durationWeeks: data.durationWeeks }),
        tags: data.tags ?? [],
      })
      .returning();

    // Auto-create a team for the post
    await this.db.insert(schema.collaborationTeams).values({
      postId: post!.id,
      name: data.title,
      description: data.description,
    });
    // Author is leader
    const team = await this.db
      .select()
      .from(schema.collaborationTeams)
      .where(eq(schema.collaborationTeams.postId, post!.id))
      .limit(1);
    if (team.length > 0) {
      await this.db.insert(schema.collaborationTeamMembers).values({
        teamId: team[0]!.id,
        userId: authorId,
        role: 'leader',
      });
    }

    return post!;
  }

  async listPosts(campusId: string, projectType?: string, status = 'open', limit = 20, cursor?: string) {
    const conditions = [eq(schema.collaborationPosts.campusId, campusId)];
    if (projectType) conditions.push(eq(schema.collaborationPosts.projectType, projectType));
    if (status) conditions.push(eq(schema.collaborationPosts.status, status));
    return this.db
      .select()
      .from(schema.collaborationPosts)
      .where(and(...conditions))
      .orderBy(desc(schema.collaborationPosts.createdAt))
      .limit(limit)
      .offset(cursor ? parseInt(cursor, 10) : 0);
  }

  async getPost(postId: string) {
    const [post] = await this.db
      .select()
      .from(schema.collaborationPosts)
      .where(eq(schema.collaborationPosts.id, postId))
      .limit(1);
    if (!post) throw AppError.notFound('Collaboration post not found');

    // Get team members
    const team = await this.db
      .select()
      .from(schema.collaborationTeams)
      .where(eq(schema.collaborationTeams.postId, postId))
      .limit(1);
    let members: any[] = [];
    if (team.length > 0) {
      members = await this.db
        .select()
        .from(schema.collaborationTeamMembers)
        .where(eq(schema.collaborationTeamMembers.teamId, team[0]!.id));
    }

    return { ...post, team: team[0] ?? null, members };
  }

  async updatePostStatus(postId: string, authorId: string, status: string) {
    const [post] = await this.db
      .select()
      .from(schema.collaborationPosts)
      .where(eq(schema.collaborationPosts.id, postId))
      .limit(1);
    if (!post) throw AppError.notFound('Post not found');
    if (post.authorId !== authorId) throw AppError.forbidden('Only the author can update status');
    await this.db
      .update(schema.collaborationPosts)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.collaborationPosts.id, postId));
  }

  async applyToPost(
    postId: string,
    applicantId: string,
    data: { message: string; relevantSkills: string[] },
  ) {
    const [post] = await this.db
      .select()
      .from(schema.collaborationPosts)
      .where(eq(schema.collaborationPosts.id, postId))
      .limit(1);
    if (!post) throw AppError.notFound('Post not found');
    if (post.status !== 'open') throw AppError.conflict('Post is closed');
    if (post.authorId === applicantId) throw AppError.forbidden('Cannot apply to your own post');
    if (post.currentMembers >= post.teamSize) throw AppError.conflict('Team is full');

    const [application] = await this.db
      .insert(schema.collaborationApplications)
      .values({
        postId,
        applicantId,
        message: data.message,
        relevantSkills: data.relevantSkills,
      })
      .onConflictDoNothing()
      .returning();

    if (!application) throw AppError.conflict('Already applied');
    return application;
  }

  async getApplicationsForPost(postId: string, authorId: string) {
    const [post] = await this.db
      .select()
      .from(schema.collaborationPosts)
      .where(eq(schema.collaborationPosts.id, postId))
      .limit(1);
    if (!post) throw AppError.notFound('Post not found');
    if (post.authorId !== authorId) throw AppError.forbidden('Only author can view applications');
    return this.db
      .select()
      .from(schema.collaborationApplications)
      .where(eq(schema.collaborationApplications.postId, postId))
      .orderBy(desc(schema.collaborationApplications.createdAt));
  }

  async respondToApplication(
    applicationId: string,
    authorId: string,
    action: 'accepted' | 'rejected',
  ) {
    const [application] = await this.db
      .select()
      .from(schema.collaborationApplications)
      .where(eq(schema.collaborationApplications.id, applicationId))
      .limit(1);
    if (!application) throw AppError.notFound('Application not found');
    const [post] = await this.db
      .select()
      .from(schema.collaborationPosts)
      .where(eq(schema.collaborationPosts.id, application.postId))
      .limit(1);
    if (!post) throw AppError.notFound('Post not found');
    if (post.authorId !== authorId) throw AppError.forbidden('Only author can respond');

    await this.db
      .update(schema.collaborationApplications)
      .set({ status: action })
      .where(eq(schema.collaborationApplications.id, applicationId));

    if (action === 'accepted') {
      // Add to team
      const [team] = await this.db
        .select()
        .from(schema.collaborationTeams)
        .where(eq(schema.collaborationTeams.postId, application.postId))
        .limit(1);
      if (team) {
        await this.db
          .insert(schema.collaborationTeamMembers)
          .values({ teamId: team.id, userId: application.applicantId, role: 'member' })
          .onConflictDoNothing();
      }
      // Update post member count
      await this.db
        .update(schema.collaborationPosts)
        .set({
          currentMembers: sql`${schema.collaborationPosts.currentMembers} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.collaborationPosts.id, application.postId));
    }

    this.publish(KafkaTopics.COLLABORATION_APPLICATION_RESPONDED, {
      applicationId,
      postId: application.postId,
      applicantId: application.applicantId,
      action,
    }).catch(() => {});
  }

  async getMyApplications(userId: string) {
    return this.db
      .select()
      .from(schema.collaborationApplications)
      .where(eq(schema.collaborationApplications.applicantId, userId))
      .orderBy(desc(schema.collaborationApplications.createdAt));
  }
}
