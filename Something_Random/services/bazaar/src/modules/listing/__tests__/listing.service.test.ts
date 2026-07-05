import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingService } from '../listing.service.js';
import { AppError } from '@nexus/utils';

// Mock the repository and external clients
const mockRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  incrementViewCount: vi.fn(),
  findOffersByListing: vi.fn(),
  findOffersByBuyer: vi.fn(),
  createOffer: vi.fn(),
  updateOfferStatus: vi.fn(),
  createTransaction: vi.fn(),
  findTransactionById: vi.fn()
};

// Mock Fastify instance
const mockFastify = {
  db: {},
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn()
  },
  kafka: {
    producer: { send: vi.fn() }
  }
} as any;

describe('ListingService', () => {
  let service: ListingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ListingService(mockFastify);
    // Replace internal repo with our mock
    (service as any).repo = mockRepo;
    
    // Mock the trust client
    (service as any).trustClient = { recordTrustEvent: vi.fn() };
    // Mock wallet client
    (service as any).walletClient = {
      holdEscrow: vi.fn().mockResolvedValue('escrow_txn_123'),
      releaseEscrow: vi.fn(),
      refundEscrow: vi.fn()
    };
  });

  describe('createListing', () => {
    it('creates a listing and returns it', async () => {
      mockRepo.create.mockResolvedValue({ id: '123', title: 'Test', status: 'active' });
      const user = { id: 'u1', campusId: 'c1', roles: ['student'], verificationLevel: 2 };
      
      const result = await service.createListing(user, {
        title: 'Test', description: 'Desc', price: 100, category: 'books', condition: 'new', tags: [], images: []
      });

      expect(result.id).toBe('123');
      expect(mockRepo.create).toHaveBeenCalled();
    });
  });

  describe('getListing', () => {
    it('returns listing from cache if available', async () => {
      mockFastify.redis.get.mockResolvedValue(JSON.stringify({ id: '123', title: 'Cached' }));
      const result = await service.getListing('123', 'viewer_1');
      expect(result.title).toBe('Cached');
      expect(mockRepo.findById).not.toHaveBeenCalled();
    });

    it('fetches from db and caches if not in cache', async () => {
      mockFastify.redis.get.mockResolvedValue(null);
      mockRepo.findById.mockResolvedValue({ id: '123', title: 'Db Item', seller_id: 'seller_1' });
      
      const result = await service.getListing('123', 'viewer_1');
      expect(result.title).toBe('Db Item');
      expect(mockFastify.redis.setex).toHaveBeenCalled();
      expect(mockRepo.incrementViewCount).toHaveBeenCalled();
    });

    it('throws 404 if listing not found', async () => {
      mockFastify.redis.get.mockResolvedValue(null);
      mockRepo.findById.mockResolvedValue(null);
      
      await expect(service.getListing('123', 'v')).rejects.toThrow(AppError);
    });
  });

  describe('initiatePurchase', () => {
    it('throws if listing is not active', async () => {
      mockRepo.findById.mockResolvedValue({ id: '123', status: 'sold', seller_id: 's1' });
      await expect(service.initiatePurchase('buyer1', '123')).rejects.toThrow('Listing is not available');
    });

    it('holds escrow and creates transaction on success', async () => {
      mockRepo.findById.mockResolvedValue({ id: '123', status: 'active', seller_id: 's1', price_in_paise: 50000 });
      mockRepo.createTransaction.mockResolvedValue({ id: 'txn1', status: 'escrow_held' });
      
      const result = await service.initiatePurchase('buyer1', '123');
      expect(result.id).toBe('txn1');
      expect((service as any).walletClient.holdEscrow).toHaveBeenCalledWith(
        'buyer1', 's1', 50000, 0, expect.any(String), 'bazaar_transaction'
      );
    });
  });
});
