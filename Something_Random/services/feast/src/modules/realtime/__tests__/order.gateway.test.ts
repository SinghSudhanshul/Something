import { describe, it, expect, vi } from 'vitest';
import orderGateway from '../order.gateway.js';

// Since the websocket gateway operates directly on raw sockets and instances,
// we will verify that the route is registered and token logic handles failures.
describe('OrderGateway', () => {
  it('registers websocket route', async () => {
    const mockFastify = {
      get: vi.fn()
    };
    await orderGateway(mockFastify as any);
    expect(mockFastify.get).toHaveBeenCalledWith('/api/v1/feast/ws', { websocket: true }, expect.any(Function));
  });

  it('handles connection logic', () => {
    const connection = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn()
    };
    
    // Simulate the handler callback
    const reqNoToken = { query: {} };
    let handlerCallback: any = null;
    const mockFastify = {
      get: vi.fn().mockImplementation((path, opts, cb) => {
        handlerCallback = cb;
      }),
      jwt: { verify: vi.fn() }
    };
    
    orderGateway(mockFastify as any);
    
    // No token
    handlerCallback(connection, reqNoToken);
    expect(connection.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Missing token' }));
    expect(connection.close).toHaveBeenCalled();

    // Invalid token
    vi.clearAllMocks();
    const reqInvalidToken = { query: { token: 'bad' } };
    mockFastify.jwt.verify.mockImplementation(() => { throw new Error('Bad token'); });
    handlerCallback(connection, reqInvalidToken);
    expect(connection.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid token', code: 401 }));
    expect(connection.close).toHaveBeenCalled();
  });
});
