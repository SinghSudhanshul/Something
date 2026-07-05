# Campusly API Documentation

This folder contains API documentation for all Campusly services.

## Services

| Service | Port | Documentation |
|---------|------|---------------|
| Auth | 3001 | [Auth API](./auth.md) |
| User | 3002 | [User API](./user.md) |
| Wallet | 3003 | [Wallet API](./wallet.md) |
| Marketplace | 3004 | [Marketplace API](./marketplace.md) |
| Food | 3005 | [Food API](./food.md) |
| Event | 3006 | [Event API](./event.md) |

## API Standards

- Base URL: `https://api.campusly.in/v1`
- Authentication: Bearer token in `Authorization` header
- Response format: JSON
- Date format: ISO 8601

## Authentication

All protected endpoints require a valid JWT access token:

```
Authorization: Bearer <access_token>
```

## Rate Limits

| Endpoint Type | Limit |
|--------------|-------|
| Standard API | 100 req/min |
| Search | 30 req/min |
| Payment | 10 req/min |
| Auth (login/OTP) | 5 req/15min |

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Invalid request body |
| UNAUTHORIZED | 401 | Missing or invalid token |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource already exists |
| INTERNAL_ERROR | 500 | Server error |
