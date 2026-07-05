import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanteenService } from '../canteen.service.js';
import * as fssaiMod from '../fssai.service.js';

const mockRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByCampus: vi.fn(),
  suspend: vi.fn(),
  createMenuItem: vi.fn(),
  findMenuByCanteen: vi.fn(),
  updateMenuItemAvailability: vi.fn()
};

const mockFastify = {
  redis: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
  redisPub: { publish: vi.fn() },
  kafka: { producer: { send: vi.fn() } }
} as any;

vi.mock('../fssai.service.js', () => ({
  validateFSSAI: vi.fn()
}));

describe('CanteenService', () => {
  let service: CanteenService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CanteenService(mockFastify);
    (service as any).repo = mockRepo;
  });

  describe('onboardCanteen', () => {
    it('throws if user is not vendor', async () => {
      await expect(service.onboardCanteen('u1', 'c1', {} as any, 'student'))
        .rejects.toThrow('Only vendors can onboard canteens');
    });

    it('throws if FSSAI is invalid', async () => {
      (fssaiMod.validateFSSAI as any).mockResolvedValue({ isValid: false });
      await expect(service.onboardCanteen('v1', 'c1', { fssai_license_no: '123' } as any, 'vendor'))
        .rejects.toThrow('FSSAI license is invalid or expired');
    });

    it('creates canteen on valid FSSAI', async () => {
      (fssaiMod.validateFSSAI as any).mockResolvedValue({ isValid: true, expiryDate: '2030-01-01' });
      mockRepo.create.mockResolvedValue({ id: 'c1', name: 'Test Canteen' });
      
      const result = await service.onboardCanteen('v1', 'c1', { name: 'Test', fssai_license_no: '123' } as any, 'vendor');
      expect(result.id).toBe('c1');
      expect(mockRepo.create).toHaveBeenCalled();
    });
  });

  describe('getCanteenMenu', () => {
    it('returns cached menu if available', async () => {
      mockFastify.redis.get.mockResolvedValue(JSON.stringify({ items: [{ id: 'm1' }] }));
      const result = await service.getCanteenMenu('c1');
      expect(result.items[0].id).toBe('m1');
      expect(mockRepo.findMenuByCanteen).not.toHaveBeenCalled();
    });

    it('fetches from DB and groups by category if not cached', async () => {
      mockFastify.redis.get.mockResolvedValue(null);
      mockRepo.findMenuByCanteen.mockResolvedValue([
        { id: 'm1', category: 'snacks' },
        { id: 'm2', category: 'lunch' }
      ]);
      const result = await service.getCanteenMenu('c1');
      expect(result.grouped['snacks'].length).toBe(1);
      expect(result.grouped['lunch'].length).toBe(1);
      expect(mockFastify.redis.setex).toHaveBeenCalled();
    });
  });
});
