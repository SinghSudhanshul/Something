import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startTransactionConsumer } from '../transaction.consumer.js';
import * as kafkaMod from '@nexus/kafka';
import * as utilsMod from '@nexus/utils';

vi.mock('@nexus/kafka', () => ({ publishEvent: vi.fn() }));
vi.mock('@nexus/utils', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createTrustClient: vi.fn(() => ({ recordTrustEvents: vi.fn() }))
}));

describe('Transaction Consumer', () => {
  let mockConsumer: any;
  let mockFastify: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumer = {
      subscribe: vi.fn(),
      run: vi.fn()
    };
    mockFastify = {
      kafka: { consumer: mockConsumer, producer: {} },
      redis: { set: vi.fn().mockResolvedValue('OK') }
    };
  });

  it('subscribes to correct topics', async () => {
    await startTransactionConsumer(mockFastify);
    expect(mockConsumer.subscribe).toHaveBeenCalledWith({
      topics: ['nexus.transactions.completed', 'nexus.transactions.refunded'],
      fromBeginning: false
    });
    expect(mockConsumer.run).toHaveBeenCalled();
  });

  it('processes a completed transaction and records trust events', async () => {
    const mockTrustClient = { recordTrustEvents: vi.fn() };
    (utilsMod.createTrustClient as any).mockReturnValue(mockTrustClient);

    await startTransactionConsumer(mockFastify);
    const runCall = mockConsumer.run.mock.calls[0][0];
    
    const message = {
      topic: 'nexus.transactions.completed',
      message: {
        offset: '1',
        value: Buffer.from(JSON.stringify({
          buyerId: 'b1', sellerId: 's1', transactionId: 'txn1'
        }))
      }
    };

    await runCall.eachMessage(message);

    expect(mockFastify.redis.set).toHaveBeenCalled();
    expect(mockTrustClient.recordTrustEvents).toHaveBeenCalledWith([
      { userId: 'b1', eventType: 'transaction_completed', referenceId: 'txn1', referenceType: 'bazaar_transaction' },
      { userId: 's1', eventType: 'listing_sold', referenceId: 'txn1', referenceType: 'bazaar_transaction' },
      { userId: 's1', eventType: 'transaction_completed', referenceId: 'txn1', referenceType: 'bazaar_transaction' },
    ]);
  });
});
