import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService } from '../task.service.js';
import { AppError } from '@nexus/utils';

const mockRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  createApplication: vi.fn(),
  findApplicationByTaskAndRunner: vi.fn(),
  rejectAllPendingApplications: vi.fn(),
  update: vi.fn(),
  updateApplicationStatus: vi.fn()
};

const mockFastify = {
  kafka: { producer: { send: vi.fn() } }
} as any;

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TaskService(mockFastify);
    (service as any).repo = mockRepo;
    (service as any).walletClient = {
      holdEscrow: vi.fn().mockResolvedValue('escrow_123'),
      releaseEscrow: vi.fn(),
      refundEscrow: vi.fn()
    };
    (service as any).trustClient = { recordTrustEvent: vi.fn() };
  });

  describe('postTask', () => {
    it('holds escrow and creates task', async () => {
      mockRepo.create.mockResolvedValue({ id: 't1', title: 'Test Task' });
      const result = await service.postTask('u1', 'c1', {
        title: 'Task', reward: 50, category: 'other', deadline_at: new Date(Date.now() + 86400000).toISOString()
      } as any);

      expect(result.id).toBe('t1');
      expect((service as any).walletClient.holdEscrow).toHaveBeenCalledWith(
        'u1', 'SYSTEM_ESCROW', 5000, 0, expect.any(String), 'swift_task'
      );
    });

    it('throws if deadline is in the past', async () => {
      await expect(service.postTask('u1', 'c1', {
        title: 'Task', reward: 50, category: 'other', deadline_at: new Date(Date.now() - 86400000).toISOString()
      } as any)).rejects.toThrow('Deadline must be in the future');
    });
  });

  describe('applyForTask', () => {
    it('throws if runner is the poster', async () => {
      mockRepo.findById.mockResolvedValue({ id: 't1', poster_id: 'u1', status: 'open' });
      await expect(service.applyForTask('t1', 'u1', 'hi')).rejects.toThrow('Cannot apply to your own task');
    });

    it('throws if task is not open', async () => {
      mockRepo.findById.mockResolvedValue({ id: 't1', poster_id: 'u1', status: 'assigned' });
      await expect(service.applyForTask('t1', 'u2', 'hi')).rejects.toThrow('Task is no longer open');
    });

    it('creates application successfully', async () => {
      mockRepo.findById.mockResolvedValue({ id: 't1', poster_id: 'u1', status: 'open' });
      mockRepo.findApplicationByTaskAndRunner.mockResolvedValue(null);
      mockRepo.createApplication.mockResolvedValue({ id: 'app1' });
      
      const result = await service.applyForTask('t1', 'u2', 'hi');
      expect(result.id).toBe('app1');
    });
  });

  describe('verifyCompletion', () => {
    it('releases escrow on approval and issues trust deltas', async () => {
      mockRepo.findById.mockResolvedValue({ id: 't1', poster_id: 'u1', runner_id: 'u2', status: 'pending_verification' });
      await service.verifyCompletion('t1', 'u1', true);
      
      expect(mockRepo.update).toHaveBeenCalledWith('t1', { status: 'completed' });
      expect((service as any).walletClient.releaseEscrow).toHaveBeenCalled();
      expect((service as any).trustClient.recordTrustEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u2', eventType: 'task_completed' })
      );
    });

    it('refunds escrow if runner failed task 3 times (rejection count logic)', async () => {
      mockRepo.findById.mockResolvedValue({ id: 't1', poster_id: 'u1', runner_id: 'u2', status: 'pending_verification', rejection_count: 2 });
      await service.verifyCompletion('t1', 'u1', false);
      
      expect(mockRepo.update).toHaveBeenCalledWith('t1', { status: 'failed', rejection_count: 3 });
      expect((service as any).walletClient.refundEscrow).toHaveBeenCalled();
      expect((service as any).trustClient.recordTrustEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u2', eventType: 'task_failed' })
      );
    });
  });
});
