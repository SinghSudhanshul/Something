/**
 * NEXUS Swift — Task Repository
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface TaskRecord {
  id: string; poster_id: string; campus_id: string; title: string; description: string | null;
  category: string; reward: string; status: string; runner_id: string | null;
  location_from: string | null; location_to: string | null; deadline_at: Date;
  completion_proof_url: string | null; completion_proof_type: string | null;
  runner_notes: string | null; rejection_count: number; created_at: Date; updated_at: Date;
}

export interface TaskApplicationRecord {
  id: string; task_id: string; runner_id: string; message: string | null;
  status: string; applied_at: Date; responded_at: Date | null;
}

export class TaskRepository {
  constructor(private readonly fastify: FastifyInstance) {}
  private get db() { return this.fastify.db; }

  async create(data: Partial<TaskRecord>): Promise<TaskRecord> {
    const r = await this.db.execute(sql`
      INSERT INTO swift_tasks (poster_id, campus_id, title, description, category, reward, location_from, location_to, deadline_at)
      VALUES (${data.poster_id}, ${data.campus_id}, ${data.title}, ${data.description ?? null},
              ${data.category}, ${data.reward}, ${data.location_from ?? null}, ${data.location_to ?? null}, ${data.deadline_at})
      RETURNING *
    `);
    return (r as any)[0] as unknown as TaskRecord;
  }

  async findById(id: string): Promise<TaskRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM swift_tasks WHERE id = ${id}`);
    return ((r as any)[0] as unknown as TaskRecord) ?? null;
  }

  async findByCampus(campusId: string, status = 'open', limit = 20): Promise<TaskRecord[]> {
    const r = await this.db.execute(sql`
      SELECT * FROM swift_tasks WHERE campus_id = ${campusId} AND status = ${status}
      ORDER BY created_at DESC LIMIT ${limit}
    `);
    return (r as any) as unknown as TaskRecord[];
  }

  async findByPoster(posterId: string): Promise<TaskRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM swift_tasks WHERE poster_id = ${posterId} ORDER BY created_at DESC`);
    return (r as any) as unknown as TaskRecord[];
  }

  async findByRunner(runnerId: string): Promise<TaskRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM swift_tasks WHERE runner_id = ${runnerId} AND status != 'open' ORDER BY created_at DESC`);
    return (r as any) as unknown as TaskRecord[];
  }

  async update(id: string, data: Partial<TaskRecord>): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    if (data.status) sets.push(`status = '${data.status}'`);
    if (data.runner_id) sets.push(`runner_id = '${data.runner_id}'`);
    if (data.completion_proof_url) sets.push(`completion_proof_url = '${data.completion_proof_url}'`);
    if (data.completion_proof_type) sets.push(`completion_proof_type = '${data.completion_proof_type}'`);
    if (data.runner_notes) sets.push(`runner_notes = '${data.runner_notes}'`);
    if (data.rejection_count !== undefined) sets.push(`rejection_count = ${data.rejection_count}`);
    await this.db.execute(sql.raw(`UPDATE swift_tasks SET ${sets.join(', ')} WHERE id = '${id}'`));
  }

  async findExpiredTasks(): Promise<TaskRecord[]> {
    const r = await this.db.execute(sql`
      SELECT * FROM swift_tasks WHERE deadline_at < NOW() AND status IN ('open', 'assigned', 'in_progress')
    `);
    return (r as any) as unknown as TaskRecord[];
  }

  // ━━━ Applications ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createApplication(taskId: string, runnerId: string, message?: string): Promise<TaskApplicationRecord> {
    const r = await this.db.execute(sql`
      INSERT INTO task_applications (task_id, runner_id, message) VALUES (${taskId}, ${runnerId}, ${message ?? null}) RETURNING *
    `);
    return (r as any)[0] as unknown as TaskApplicationRecord;
  }

  async findApplicationsByTask(taskId: string): Promise<TaskApplicationRecord[]> {
    const r = await this.db.execute(sql`SELECT ta.*, u.name as runner_name FROM task_applications ta JOIN users u ON u.id = ta.runner_id WHERE ta.task_id = ${taskId} ORDER BY ta.applied_at DESC`);
    return (r as any) as unknown as TaskApplicationRecord[];
  }

  async findApplicationByTaskAndRunner(taskId: string, runnerId: string): Promise<TaskApplicationRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM task_applications WHERE task_id = ${taskId} AND runner_id = ${runnerId}`);
    return ((r as any)[0] as unknown as TaskApplicationRecord) ?? null;
  }

  async updateApplicationStatus(id: string, status: string): Promise<TaskApplicationRecord> {
    const r = await this.db.execute(sql.raw(`UPDATE task_applications SET status = '${status}', responded_at = now() WHERE id = '${id}' RETURNING *`));
    return (r as any)[0] as unknown as TaskApplicationRecord;
  }

  async rejectAllPendingApplications(taskId: string, exceptRunnerId: string): Promise<void> {
    await this.db.execute(sql`UPDATE task_applications SET status = 'rejected', responded_at = now() WHERE task_id = ${taskId} AND runner_id != ${exceptRunnerId} AND status = 'pending'`);
  }

  // ━━━ Ratings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createRating(taskId: string, raterId: string, rateeId: string, score: number, reviewText?: string): Promise<void> {
    await this.db.execute(sql`INSERT INTO task_ratings (task_id, rater_id, ratee_id, score, review_text) VALUES (${taskId}, ${raterId}, ${rateeId}, ${score}, ${reviewText ?? null})`);
  }
}
