/**
 * NEXUS Pulse — Community Groups & Team Formation Service
 *
 * Community boards, posts, comments, and event team formation.
 */

import { and, desc, eq, sql, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError, createLogger } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';

import * as schema from '@nexus/database/schema';

const logger = createLogger('pulse:community-service');

export class CommunityService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.db;
  }

  private async publish(topic: string, data: unknown) {
    const producer = this.fastify.kafka?.producer;
    if (producer) await publishEvent(producer, topic as any, data);
  }

  // ━━━ Groups ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createGroup(
    creatorId: string,
    campusId: string,
    data: { name: string; description: string; category: string; isPublic: boolean; requiresApproval: boolean; tags?: string[]; rules?: string },
  ) {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
    const [group] = await this.db
      .insert(schema.communityGroups)
      .values({
        campusId,
        creatorId,
        name: data.name,
        slug,
        description: data.description,
        category: data.category,
        isPublic: data.isPublic,
        requiresApproval: data.requiresApproval,
        tags: data.tags ?? [],
        rules: data.rules,
      })
      .returning();
    // Add creator as admin
    await this.db.insert(schema.communityGroupMembers).values({
      groupId: group!.id,
      userId: creatorId,
      role: 'admin',
    });
    return group!;
  }

  async listGroups(campusId: string, category?: string, limit = 20, cursor?: string) {
    const conditions = [eq(schema.communityGroups.campusId, campusId)];
    if (category) conditions.push(eq(schema.communityGroups.category, category));
    const items = await this.db
      .select()
      .from(schema.communityGroups)
      .where(and(...conditions))
      .orderBy(desc(schema.communityGroups.memberCount))
      .limit(limit)
      .offset(cursor ? parseInt(cursor, 10) : 0);
    return items;
  }

  async getGroup(id: string) {
    const [group] = await this.db
      .select()
      .from(schema.communityGroups)
      .where(eq(schema.communityGroups.id, id))
      .limit(1);
    if (!group) throw AppError.notFound('Group not found');
    return group;
  }

  async joinGroup(groupId: string, userId: string) {
    const group = await this.getGroup(groupId);
    if (group.requiresApproval) {
      throw AppError.conflict('Group requires approval to join');
    }
    await this.db
      .insert(schema.communityGroupMembers)
      .values({ groupId, userId, role: 'member' })
      .onConflictDoNothing();
    await this.db
      .update(schema.communityGroups)
      .set({ memberCount: sql`${schema.communityGroups.memberCount} + 1` })
      .where(eq(schema.communityGroups.id, groupId));
  }

  async leaveGroup(groupId: string, userId: string) {
    const [member] = await this.db
      .select()
      .from(schema.communityGroupMembers)
      .where(
        and(
          eq(schema.communityGroupMembers.groupId, groupId),
          eq(schema.communityGroupMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!member) throw AppError.notFound('Not a member of this group');
    if (member.role === 'admin') {
      const adminCount = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.communityGroupMembers)
        .where(
          and(
            eq(schema.communityGroupMembers.groupId, groupId),
            eq(schema.communityGroupMembers.role, 'admin'),
          ),
        );
      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw AppError.conflict('Cannot leave: you are the only admin');
      }
    }
    await this.db
      .delete(schema.communityGroupMembers)
      .where(
        and(
          eq(schema.communityGroupMembers.groupId, groupId),
          eq(schema.communityGroupMembers.userId, userId),
        ),
      );
    await this.db
      .update(schema.communityGroups)
      .set({ memberCount: sql`${schema.communityGroups.memberCount} - 1` })
      .where(eq(schema.communityGroups.id, groupId));
  }

  async listGroupMembers(groupId: string, limit = 50) {
    return this.db
      .select()
      .from(schema.communityGroupMembers)
      .where(eq(schema.communityGroupMembers.groupId, groupId))
      .orderBy(desc(schema.communityGroupMembers.joinedAt))
      .limit(limit);
  }

  // ━━━ Posts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createPost(
    authorId: string,
    groupId: string,
    data: { title?: string; body: string; imageUrls?: string[]; isPinned?: boolean },
  ) {
    // Verify membership
    const [member] = await this.db
      .select()
      .from(schema.communityGroupMembers)
      .where(
        and(
          eq(schema.communityGroupMembers.groupId, groupId),
          eq(schema.communityGroupMembers.userId, authorId),
        ),
      )
      .limit(1);
    if (!member) throw AppError.forbidden('You must be a member to post');

    const [post] = await this.db
      .insert(schema.communityPosts)
      .values({
        groupId,
        authorId,
        title: data.title,
        body: data.body,
        imageUrls: data.imageUrls ?? [],
        isPinned: member.role === 'admin' ? (data.isPinned ?? false) : false,
      })
      .returning();
    await this.db
      .update(schema.communityGroups)
      .set({ postCount: sql`${schema.communityGroups.postCount} + 1` })
      .where(eq(schema.communityGroups.id, groupId));
    return post!;
  }

  async listPosts(groupId: string, limit = 20, cursor?: string) {
    return this.db
      .select()
      .from(schema.communityPosts)
      .where(eq(schema.communityPosts.groupId, groupId))
      .orderBy(desc(schema.communityPosts.isPinned), desc(schema.communityPosts.createdAt))
      .limit(limit)
      .offset(cursor ? parseInt(cursor, 10) : 0);
  }

  async getPost(postId: string) {
    const [post] = await this.db
      .select()
      .from(schema.communityPosts)
      .where(eq(schema.communityPosts.id, postId))
      .limit(1);
    if (!post) throw AppError.notFound('Post not found');
    return post;
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.getPost(postId);
    if (post.authorId !== userId) {
      // Check if user is admin
      const [member] = await this.db
        .select()
        .from(schema.communityGroupMembers)
        .where(
          and(
            eq(schema.communityGroupMembers.groupId, post.groupId),
            eq(schema.communityGroupMembers.userId, userId),
            eq(schema.communityGroupMembers.role, 'admin'),
          ),
        )
        .limit(1);
      if (!member) throw AppError.forbidden('You can only delete your own posts');
    }
    await this.db.delete(schema.communityPosts).where(eq(schema.communityPosts.id, postId));
    await this.db
      .update(schema.communityGroups)
      .set({ postCount: sql`${schema.communityGroups.postCount} - 1` })
      .where(eq(schema.communityGroups.id, post.groupId));
  }

  async pinPost(postId: string, userId: string, isPinned: boolean) {
    const post = await this.getPost(postId);
    const [member] = await this.db
      .select()
      .from(schema.communityGroupMembers)
      .where(
        and(
          eq(schema.communityGroupMembers.groupId, post.groupId),
          eq(schema.communityGroupMembers.userId, userId),
          eq(schema.communityGroupMembers.role, 'admin'),
        ),
      )
      .limit(1);
    if (!member) throw AppError.forbidden('Only admins can pin posts');
    await this.db
      .update(schema.communityPosts)
      .set({ isPinned, updatedAt: new Date() })
      .where(eq(schema.communityPosts.id, postId));
  }

  // ━━━ Comments ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createComment(authorId: string, postId: string, body: string, parentCommentId?: string) {
    const post = await this.getPost(postId);
    if (post.isLocked) throw AppError.conflict('Post is locked');
    // verify membership
    const [member] = await this.db
      .select()
      .from(schema.communityGroupMembers)
      .where(
        and(
          eq(schema.communityGroupMembers.groupId, post.groupId),
          eq(schema.communityGroupMembers.userId, authorId),
        ),
      )
      .limit(1);
    if (!member) throw AppError.forbidden('You must be a member to comment');

    const [comment] = await this.db
      .insert(schema.communityPostComments)
      .values({
        postId,
        authorId,
        parentCommentId,
        body,
      })
      .returning();
    await this.db
      .update(schema.communityPosts)
      .set({ commentCount: sql`${schema.communityPosts.commentCount} + 1` })
      .where(eq(schema.communityPosts.id, postId));
    return comment!;
  }

  async listComments(postId: string, limit = 50) {
    return this.db
      .select()
      .from(schema.communityPostComments)
      .where(eq(schema.communityPostComments.postId, postId))
      .orderBy(schema.communityPostComments.createdAt)
      .limit(limit);
  }

  // ━━━ Team Formation ━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createTeamFormationPost(
    creatorId: string,
    eventId: string,
    data: { teamName: string; description?: string; skillsNeeded: string[]; teamSize: number },
  ) {
    // Verify event exists
    const [event] = await this.db
      .select()
      .from(schema.campusEvents)
      .where(eq(schema.campusEvents.id, eventId))
      .limit(1);
    if (!event) throw AppError.notFound('Event not found');

    const [post] = await this.db
      .insert(schema.teamFormationPosts)
      .values({
        eventId,
        creatorId,
        teamName: data.teamName,
        description: data.description,
        skillsNeeded: data.skillsNeeded,
        teamSize: data.teamSize,
      })
      .returning();
    return post!;
  }

  async listTeamFormationPosts(eventId: string, isOpen = true) {
    const conditions = [eq(schema.teamFormationPosts.eventId, eventId)];
    if (isOpen) conditions.push(eq(schema.teamFormationPosts.isOpen, true));
    return this.db
      .select()
      .from(schema.teamFormationPosts)
      .where(and(...conditions))
      .orderBy(desc(schema.teamFormationPosts.createdAt));
  }

  async getTeamFormationPost(postId: string) {
    const [post] = await this.db
      .select()
      .from(schema.teamFormationPosts)
      .where(eq(schema.teamFormationPosts.id, postId))
      .limit(1);
    if (!post) throw AppError.notFound('Team formation post not found');
    return post;
  }

  async requestToJoinTeam(postId: string, userId: string, message?: string) {
    const post = await this.getTeamFormationPost(postId);
    if (!post.isOpen) throw AppError.conflict('Team is not accepting new members');
    if (post.currentSize >= post.teamSize) throw AppError.conflict('Team is full');
    if (post.creatorId === userId) throw AppError.forbidden('Cannot join your own team');

    const [request] = await this.db
      .insert(schema.teamFormationJoinRequests)
      .values({ teamPostId: postId, userId, message })
      .returning();
    return request!;
  }

  async respondToJoinRequest(
    requestId: string,
    creatorId: string,
    action: 'accepted' | 'rejected',
  ) {
    const [request] = await this.db
      .select()
      .from(schema.teamFormationJoinRequests)
      .where(eq(schema.teamFormationJoinRequests.id, requestId))
      .limit(1);
    if (!request) throw AppError.notFound('Join request not found');
    const post = await this.getTeamFormationPost(request.teamPostId);
    if (post.creatorId !== creatorId) throw AppError.forbidden('Only team creator can respond');

    await this.db
      .update(schema.teamFormationJoinRequests)
      .set({ status: action })
      .where(eq(schema.teamFormationJoinRequests.id, requestId));

    if (action === 'accepted') {
      const newSize = post.currentSize + 1;
      await this.db
        .update(schema.teamFormationPosts)
        .set({
          currentSize: newSize,
          isOpen: newSize < post.teamSize,
        })
        .where(eq(schema.teamFormationPosts.id, post.id));
    }
  }

  async listJoinRequests(postId: string, creatorId: string) {
    const post = await this.getTeamFormationPost(postId);
    if (post.creatorId !== creatorId) throw AppError.forbidden('Only team creator can view requests');
    return this.db
      .select()
      .from(schema.teamFormationJoinRequests)
      .where(eq(schema.teamFormationJoinRequests.teamPostId, postId))
      .orderBy(desc(schema.teamFormationJoinRequests.createdAt));
  }
}
