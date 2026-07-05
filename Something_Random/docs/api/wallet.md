# Wallet Service API

Base URL: `/wallet`

**Authentication Required:** All endpoints require valid access token.

## Endpoints

### GET /wallet/balance

Get wallet balance for authenticated user.

**Response (200):**
```json
{
  "data": {
    "user_id": "uuid",
    "balance": 1500.00,
    "locked_balance": 200.00,
    "currency": "INR",
    "available_balance": 1300.00
  }
}
```

### GET /wallet/transactions

Get transaction history.

**Query Parameters:**
- `limit` (optional): Number of transactions (default: 20)
- `type` (optional): Filter by transaction type

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "reference_type": "topup",
      "reference_id": "order_xyz",
      "amount": 500.00,
      "status": "completed",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "meta": {
    "total": 1,
    "limit": 20
  }
}
```

### POST /wallet/topup

Initiate wallet top-up via Razorpay.

**Request:**
```json
{
  "amount": 500,
  "idempotency_key": "unique-key-123"
}
```

**Response (200):**
```json
{
  "message": "Top-up initiated",
  "order_id": "order_xyz123",
  "key_id": "rzp_test_key",
  "amount": 500,
  "currency": "INR"
}
```

### POST /wallet/withdraw

Initiate withdrawal to bank account.

**Request:**
```json
{
  "amount": 1000,
  "bank_account": "1234567890",
  "ifsc": "SBIN0001234",
  "idempotency_key": "unique-key-456"
}
```

**Response (200):**
```json
{
  "message": "Withdrawal initiated",
  "transaction_id": "uuid",
  "amount": 1000,
  "status": "pending",
  "estimated_arrival": "2-3 business days"
}
```

### POST /wallet/transfer

Transfer funds to another user (P2P).

**Request:**
```json
{
  "recipient_id": "user-uuid",
  "amount": 200,
  "idempotency_key": "unique-key-789"
}
```

**Response (200):**
```json
{
  "message": "Transfer successful",
  "transaction_id": "uuid",
  "amount": 200,
  "recipient_id": "user-uuid"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid amount"
  }
}
```

### 400 Insufficient Balance
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient wallet balance"
  }
}
```

### 401 Unauthorized
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "No access token provided"
  }
}
```

## Webhooks

### POST /webhooks/razorpay

Handle Razorpay payment events.

**Headers:**
- `X-Razorpay-Signature`: HMAC-SHA256 signature

**Event Types:**
- `payment.captured` - Payment successful
- `payment.failed` - Payment failed
