import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventService } from '../event.service.js';
import { AppError } from '@nexus/utils';

// We mock mongoose methods using vi.fn()
const mockEventModel = {
  create: vi.fn(),
  find: vi.fn(),
  findById: vi.fn(),
  findOneAndUpdate: vi.fn()
};

const mockClubModel = {
  create: vi.fn(),
  find: vi.fn()
};

const mockFastify = {
  mongoose: {
    model: (name: string) => name === 'Event' ? mockEventModel : mockClubModel
  },
  kafka: { producer: { send: vi.fn() } },
  db: { execute: vi.fn() }
} as any;

describe('EventService', () => {
  let service: EventService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EventService(mockFastify);
    (service as any).walletClient = {
      chargeWallet: vi.fn().mockResolvedValue('txn_123')
    };
  });

  describe('createEvent', () => {
    it('throws if user has low trust score', async () => {
      await expect(service.createEvent('u1', 'c1', {} as any, 2.5))
        .rejects.toThrow('Trust score must be at least 3.0');
    });

    it('saves to MongoDB successfully', async () => {
      mockEventModel.create.mockResolvedValue({ id: 'e1', title: 'Test Event' });
      const result = await service.createEvent('u1', 'c1', {
        title: 'Test', startAt: new Date().toISOString(), endAt: new Date().toISOString(), ticketTypes: []
      } as any, 4.0);
      
      expect(result.id).toBe('e1');
      expect(mockEventModel.create).toHaveBeenCalled();
    });
  });

  describe('purchaseTickets', () => {
    it('throws if event not found or published', async () => {
      mockEventModel.findById.mockResolvedValue({ id: 'e1', status: 'draft' });
      await expect(service.purchaseTickets('e1', 't1', 1, 'u1'))
        .rejects.toThrow('Event not found or not open for registration');
    });

    it('charges wallet for paid tickets and stores in Postgres', async () => {
      mockEventModel.findById.mockResolvedValue({
        id: 'e1', status: 'published', organizerId: 'org1',
        ticketTypes: [{ id: 't1', price: 100, totalCount: 10 }]
      });
      // Mock MongoDB atomic decrement
      mockEventModel.findOneAndUpdate.mockResolvedValue({ id: 'e1' });
      // Mock Postgres insert
      mockFastify.db.execute.mockResolvedValue({ rows: [{ id: 'ticket_record_1' }] });

      const result = await service.purchaseTickets('e1', 't1', 2, 'u1');
      
      expect(result.ticketIds.length).toBe(2);
      expect((service as any).walletClient.chargeWallet).toHaveBeenCalledWith(
        'u1', 'org1', 20000, 'pulse_ticket'
      );
      expect(mockEventModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('reverts ticket count if wallet charge fails', async () => {
      mockEventModel.findById.mockResolvedValue({
        id: 'e1', status: 'published', organizerId: 'org1',
        ticketTypes: [{ id: 't1', price: 100, totalCount: 10 }]
      });
      mockEventModel.findOneAndUpdate.mockResolvedValue({ id: 'e1' });
      (service as any).walletClient.chargeWallet.mockRejectedValue(new Error('Insufficient balance'));

      await expect(service.purchaseTickets('e1', 't1', 1, 'u1')).rejects.toThrow('Insufficient balance');
      
      // Should have called findOneAndUpdate twice (once to reserve, once to refund)
      expect(mockEventModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
