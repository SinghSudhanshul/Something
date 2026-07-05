import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderService } from '../order.service.js';
import { AppError } from '@nexus/utils';

const mockOrderRepo = {
  create: vi.fn(),
  createOrderItems: vi.fn(),
  findById: vi.fn(),
  findByBuyer: vi.fn(),
  updateStatus: vi.fn(),
  getActiveOrdersForCanteen: vi.fn()
};

const mockCanteenRepo = {
  findById: vi.fn(),
  findMenuItemsByIds: vi.fn()
};

const mockFastify = {
  redisPub: { publish: vi.fn() },
  kafka: { producer: { send: vi.fn() } },
} as any;

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderService(mockFastify);
    (service as any).orderRepo = mockOrderRepo;
    (service as any).canteenRepo = mockCanteenRepo;
    (service as any).walletClient = {
      holdEscrow: vi.fn().mockResolvedValue('escrow_123'),
      releaseEscrow: vi.fn(),
      refundEscrow: vi.fn()
    };
  });

  describe('placeOrder', () => {
    it('throws if canteen is inactive or closed', async () => {
      mockCanteenRepo.findById.mockResolvedValue({ id: 'c1', is_active: false });
      await expect(service.placeOrder('u1', 'c1', [], 'pickup'))
        .rejects.toThrow('Canteen is not currently active');
    });

    it('throws if menu items are unavailable', async () => {
      mockCanteenRepo.findById.mockResolvedValue({ id: 'c1', is_active: true, owner_user_id: 'v1' });
      mockOrderRepo.getActiveOrdersForCanteen.mockResolvedValue(5);
      mockCanteenRepo.findMenuItemsByIds.mockResolvedValue([
        { id: 'm1', is_available: false, price: 100 }
      ]);

      await expect(service.placeOrder('u1', 'c1', [{ menuItemId: 'm1', quantity: 1 }], 'pickup'))
        .rejects.toThrow('Some items are unavailable');
    });

    it('calculates price, holds escrow, creates order, and publishes event', async () => {
      mockCanteenRepo.findById.mockResolvedValue({ id: 'c1', is_active: true, owner_user_id: 'v1' });
      mockOrderRepo.getActiveOrdersForCanteen.mockResolvedValue(5);
      mockCanteenRepo.findMenuItemsByIds.mockResolvedValue([
        { id: 'm1', is_available: true, price: 100 }
      ]);
      mockOrderRepo.create.mockResolvedValue({ id: 'o1', canteen_id: 'c1', total_price: 100 });

      const result = await service.placeOrder('u1', 'c1', [{ menuItemId: 'm1', quantity: 2 }], 'pickup');
      
      expect(result.id).toBe('o1');
      expect((service as any).walletClient.holdEscrow).toHaveBeenCalledWith(
        'u1', 'v1', 20000, 0, expect.any(String), 'feast_order'
      );
      expect(mockFastify.redisPub.publish).toHaveBeenCalledWith('feast:canteen:c1:new_order', expect.any(String));
    });
  });

  describe('updateOrderStatus', () => {
    it('throws if vendor does not own canteen', async () => {
      mockOrderRepo.findById.mockResolvedValue({ id: 'o1', canteen_id: 'c1' });
      mockCanteenRepo.findById.mockResolvedValue({ id: 'c1', owner_user_id: 'v2' });
      
      await expect(service.updateOrderStatus('o1', 'ready', 'v1'))
        .rejects.toThrow('Not the canteen owner');
    });

    it('releases escrow on completion and publishes event', async () => {
      mockOrderRepo.findById.mockResolvedValue({ id: 'o1', canteen_id: 'c1', transaction_id: 't1' });
      mockCanteenRepo.findById.mockResolvedValue({ id: 'c1', owner_user_id: 'v1' });
      
      await service.updateOrderStatus('o1', 'delivered', 'v1');
      
      expect(mockOrderRepo.updateStatus).toHaveBeenCalledWith('o1', 'delivered');
      expect((service as any).walletClient.releaseEscrow).toHaveBeenCalledWith('t1');
      expect(mockFastify.redisPub.publish).toHaveBeenCalledWith('feast:order:o1:status', expect.any(String));
    });
  });
});
