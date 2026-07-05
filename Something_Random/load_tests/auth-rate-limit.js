import http from 'k6/http';
import { check, sleep } from 'k6';

// This script simulates 1000 users constantly hitting the login endpoint to achieve max RPS
export const options = {
  vus: 1000, // Reduced from 10k to prevent macOS TCP backlog drops
  duration: '5s', // Run for 5s to measure sustained RPS
};

export default function () {
  const url = 'http://localhost:3001/api/v1/auth/login';
  const payload = JSON.stringify({
    email: 'test@srmist.edu.in',
    password: 'WrongPassword123!',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, payload, params);

  // Check if the rate limiter kicks in (HTTP 429 Too Many Requests)
  check(res, {
    'is status 429 (Rate Limited)': (r) => r.status === 429,
    'is status 401 (Unauthorized - before limit)': (r) => r.status === 401,
  });
}
