import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillService } from '../skill.service.js';

const mockRepo = {
  createListing: vi.fn(),
  findListingById: vi.fn(),
  createOrder: vi.fn(),
  findOrderById: vi.fn(),
  updateOrder: vi.fn()
};

const mockFastify = {
  kafka: { producer: { send: vi.fn() } }
} as any;

describe('SkillService', () => {
  let service: SkillService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SkillService(mockFastify);
    (service as any).repo = mockRepo;
    (service as any).walletClient = {
      holdEscrow: vi.fn().mockResolvedValue('escrow_123'),
      releaseEscrow: vi.fn(),
      refundEscrow: vi.fn()
    };
    (service as any).trustClient = { recordTrustEvent: vi.fn() };
  });

  describe('placeOrder', () => {
    it('holds escrow and creates order', async () => {
      mockRepo.findListingById.mockResolvedValue({
        id: 'l1', provider_id: 'p1', status: 'active',
        packages: [{ id: 'pkg1', price: 1000 }]
      });
      mockRepo.createOrder.mockResolvedValue({ id: 'o1' });

      const result = await service.placeOrder('buyer1', 'l1', 'pkg1', 'Reqs');
      
      expect(result.id).toBe('o1');
      expect((service as any).walletClient.holdEscrow).toHaveBeenCalledWith(
        'buyer1', 'p1', 100000, expect.any(Number), expect.any(String), 'skills_order'
      );
    });
  });

  describe('approveDelivery', () => {
    it('releases escrow and updates status to completed', async () => {
      mockRepo.findOrderById.mockResolvedValue({
        id: 'o1', buyer_id: 'buyer1', provider_id: 'p1', transaction_id: 'txn1', status: 'pending_review'
      });

      await service.approveDelivery('o1', 'buyer1');
      
      expect(mockRepo.updateOrder).toHaveBeenCalledWith('o1', { status: 'completed' });
      expect((service as any).walletClient.releaseEscrow).toHaveBeenCalledWith('txn1');
      expect((service as any).trustClient.recordTrustEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'p1', eventType: 'skill_delivered' })
      );
    });
  });

  describe('requestRevision', () => {
    it('updates status and increments revision count', async () => {
      mockRepo.findOrderById.mockResolvedValue({
        id: 'o1', buyer_id: 'buyer1', status: 'pending_review', revision_count: 0, max_revisions: 2
      });

      await service.requestRevision('o1', 'buyer1', 'Need changes');
      
      expect(mockRepo.updateOrder).toHaveBeenCalledWith('o1', { status: 'in_progress', revision_count: 1 });
    });

    it('throws if max revisions reached', async () => {
      mockRepo.findOrderById.mockResolvedValue({
        id: 'o1', buyer_id: 'buyer1', status: 'pending_review', revision_count: 2, max_revisions: 2
      });

      await expect(service.requestRevision('o1', 'buyer1', 'Need changes')).rejects.toThrow('Maximum revisions reached');
    });
  });
});
