# Auth Service API

Base URL: `/auth`

## Endpoints

### POST /auth/register

Initiate registration by sending OTP to institutional email.

**Request:**
```json
{
  "email": "student@srmist.edu.in",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "message": "OTP sent to your institutional email",
  "email": "student@srmist.edu.in",
  "expires_in": 600
}
```

### POST /auth/verify-otp

Verify OTP and create user account.

**Request:**
```json
{
  "email": "student@srmist.edu.in",
  "otp": "123456",
  "name": "John Doe",
  "username": "johndoe",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "message": "Registration successful",
  "user": {
    "id": "uuid",
    "email": "student@srmist.edu.in",
    "name": "John Doe",
    "username": "johndoe"
  },
  "access_token": "eyJ...",
  "refresh_token": "abc123...",
  "expires_in": 900
}
```

### POST /auth/login

Login with email and password.

**Request:**
```json
{
  "email": "student@srmist.edu.in",
  "password": "SecurePassword123!",
  "deviceId": "device-uuid"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "student@srmist.edu.in"
  },
  "access_token": "eyJ...",
  "refresh_token": "abc123...",
  "expires_in": 900
}
```

### POST /auth/logout

Logout and revoke refresh token.

**Headers:** `Authorization: Bearer <access_token>`

**Request:**
```json
{
  "refresh_token": "abc123..."
}
```

**Response (200):**
```json
{
  "message": "Logout successful"
}
```

### POST /auth/refresh

Refresh access token using refresh token.

**Request:**
```json
{
  "refresh_token": "abc123..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJ...",
  "expires_in": 900
}
```

### POST /auth/forgot-password

Initiate password reset flow.

**Request:**
```json
{
  "email": "student@srmist.edu.in"
}
```

**Response (200):**
```json
{
  "message": "If the email exists, an OTP will be sent",
  "expires_in": 600
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email and password are required"
  }
}
```

### 401 Unauthorized
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired access token"
  }
}
```

### 409 Conflict
```json
{
  "error": {
    "code": "USER_EXISTS",
    "message": "User with this email already exists"
  }
}
```
