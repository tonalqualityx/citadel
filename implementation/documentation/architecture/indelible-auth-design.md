# Indelible App: Authentication & Authorization Design
## Phase 3.4 Technical Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document defines the complete security architecture for Indelible, covering user authentication, session management, and permission enforcement throughout the system.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Defense in Depth** | Three security layers: frontend, API, data |
| **Least Privilege** | Users see only what their role permits |
| **Secure by Default** | httpOnly cookies, short token lifetimes |
| **Graceful Degradation** | Session expiry preserves user context |
| **Audit Trail** | All security events logged |

---

## 1. Authentication Flow

### 1.1 Login Mechanics

**Approach: Email/Password Authentication**

For an internal agency tool with 3-20 users, email/password is the right choice for MVP. SSO (Google Workspace, etc.) can be a future enhancement but adds complexity without proportional value at this scale.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                        LOGIN FLOW                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  â”‚  User    â”‚         â”‚ Frontend â”‚         â”‚  API     â”‚
  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜
       â”‚                    â”‚                    â”‚
       â”‚  Enter credentials â”‚                    â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚                    â”‚
       â”‚                    â”‚                    â”‚
       â”‚                    â”‚  POST /auth/login  â”‚
       â”‚                    â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚
       â”‚                    â”‚                    â”‚
       â”‚                    â”‚                    â”œâ”€â”€ Validate credentials
       â”‚                    â”‚                    â”œâ”€â”€ Check account status
       â”‚                    â”‚                    â”œâ”€â”€ Generate tokens
       â”‚                    â”‚                    â”œâ”€â”€ Log login event
       â”‚                    â”‚                    â”‚
       â”‚                    â”‚  Set httpOnly      â”‚
       â”‚                    â”‚  cookie + user     â”‚
       â”‚                    â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
       â”‚                    â”‚                    â”‚
       â”‚                    â”œâ”€â”€ Store user in    â”‚
       â”‚                    â”‚   React Query      â”‚
       â”‚                    â”œâ”€â”€ Redirect to      â”‚
       â”‚                    â”‚   /overlook        â”‚
       â”‚                    â”‚                    â”‚
       â”‚  Dashboard loaded  â”‚                    â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                    â”‚
```

### 1.2 Login Request/Response

**Request:**
```json
{
  "email": "mike@indelible.agency",
  "password": "securePassword123",
  "remember_me": true
}
```

**Success Response (200):**
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "mike@indelible.agency",
      "name": "Mike Hansen",
      "role": "admin",
      "avatar_url": "https://...",
      "functions": ["dev", "design"],
      "preferences": {
        "theme": "sepia",
        "sidebar_collapsed": false
      }
    }
  }
}
```

*Note: Access token is delivered via httpOnly cookie, not in response body.*

**Error Responses:**

| Status | Code | Message | Scenario |
|--------|------|---------|----------|
| 401 | `invalid_credentials` | Invalid email or password | Wrong password or email not found |
| 423 | `account_locked` | Account temporarily locked | Too many failed attempts |
| 403 | `account_deactivated` | Account has been deactivated | User.is_active = false |

### 1.3 Logout Flow

**Single-Device Logout (Default):**
```
POST /auth/logout

Response: 204 No Content
+ Clear httpOnly cookie
+ Invalidate refresh token for this device
```

**All-Device Logout (Future Enhancement):**
```
POST /auth/logout-all

Response: 204 No Content
+ Invalidate all refresh tokens for user
```

For MVP, single-device logout is sufficient. With only 3-20 users, the "logged in elsewhere" scenario is rare.

---

## 2. Token Architecture

### 2.1 Dual-Token Strategy

**Approach: Access Token + Refresh Token**

| Token | Purpose | Lifetime | Storage |
|-------|---------|----------|---------|
| **Access Token** | API authorization | 15 minutes | httpOnly cookie |
| **Refresh Token** | Obtain new access token | 7 days (or 30 if "remember me") | httpOnly cookie |

**Why httpOnly Cookies over localStorage?**
- Protection against XSS attacks (JavaScript can't read the token)
- Automatic inclusion in requests (no manual header management)
- Better security posture for sensitive agency data

### 2.2 Token Payload (JWT Claims)

**Access Token:**
```json
{
  "sub": "user-uuid",
  "email": "mike@indelible.agency",
  "role": "admin",
  "iat": 1703160000,
  "exp": 1703160900,
  "jti": "unique-token-id"
}
```

| Claim | Purpose |
|-------|---------|
| `sub` | User ID (subject) |
| `email` | Quick identification in logs |
| `role` | Authorization decisions without DB lookup |
| `iat` | Issued at (for audit) |
| `exp` | Expiration time |
| `jti` | Unique token ID (for revocation tracking) |

**What NOT to include:**
- Sensitive data (rates, billing info)
- Data that changes frequently (name, avatar)
- Large arrays (function assignments)

### 2.3 Token Refresh Flow

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                     TOKEN REFRESH FLOW                           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  â”‚ Frontend â”‚         â”‚   API    â”‚         â”‚    DB    â”‚
  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜
       â”‚                    â”‚                    â”‚
       â”‚  API request with  â”‚                    â”‚
       â”‚  expired access    â”‚                    â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚                    â”‚
       â”‚                    â”‚                    â”‚
       â”‚  401 token_expired â”‚                    â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                    â”‚
       â”‚                    â”‚                    â”‚
       â”‚  POST /auth/refreshâ”‚                    â”‚
       â”‚  (refresh token in â”‚                    â”‚
       â”‚   httpOnly cookie) â”‚                    â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚                    â”‚
       â”‚                    â”‚                    â”‚
       â”‚                    â”‚  Validate refresh  â”‚
       â”‚                    â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚
       â”‚                    â”‚                    â”‚
       â”‚                    â”‚  Check not revoked â”‚
       â”‚                    â”‚  Check user active â”‚
       â”‚                    â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
       â”‚                    â”‚                    â”‚
       â”‚  New access token  â”‚                    â”‚
       â”‚  (in cookie)       â”‚                    â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                    â”‚
       â”‚                    â”‚                    â”‚
       â”‚  Retry original    â”‚                    â”‚
       â”‚  request           â”‚                    â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚                    â”‚
```

**Refresh Token Rotation:**
Each refresh generates a new refresh token, invalidating the old one. This limits the window if a refresh token is compromised.

---

## 3. Session Management

### 3.1 Timeout Rules

| Scenario | Timeout | Behavior |
|----------|---------|----------|
| **Idle Timeout** | 30 minutes | After 30 min of no API calls, next request triggers re-auth |
| **Access Token Expiry** | 15 minutes | Silent refresh via refresh token |
| **Refresh Token Expiry** | 7 days | Full re-login required |
| **"Remember Me" Refresh** | 30 days | Extended refresh token lifetime |
| **Absolute Timeout** | 30 days | Even with activity, force re-login monthly |

### 3.2 "Remember Me" Implementation

**Checked (Default for agency tool):**
- Refresh token: 30 days
- User stays logged in across browser restarts
- Better UX for daily-use tool

**Unchecked:**
- Refresh token: 7 days
- Session cookie (expires on browser close)
- For shared computers (unlikely in this context)

**Recommendation:** Default "Remember Me" to checked, since this is an internal tool used daily by the same people on their own devices.

### 3.3 Session Tracking

**Stored in Database:**

```sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  refresh_token_hash VARCHAR(64) NOT NULL,
  device_info JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
```

**Device Info (JSONB):**
```json
{
  "user_agent": "Mozilla/5.0...",
  "browser": "Chrome",
  "os": "macOS",
  "device_type": "desktop"
}
```

This enables:
- "Logout all devices" functionality
- Security audit trail
- Future: "Active sessions" view in settings

### 3.4 Graceful Session Expiration

**Frontend Handling:**

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  SESSION EXPIRATION UX                           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

When refresh fails (401 on /auth/refresh):

1. Clear local user state
2. Preserve current URL in sessionStorage
3. Redirect to /login with message: 
   "Your session has expired. Please log in again."
4. After successful login, redirect to preserved URL

This prevents losing work context after timeout.
```

**Timer Warning (Optional Enhancement):**
Show toast 2 minutes before idle timeout: "Session expiring soon. Click to stay logged in."

---

## 4. Role Enforcement

### 4.1 Three-Layer Security Model

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    SECURITY LAYERS                               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LAYER 1: FRONTEND ROUTE GUARDS                                  â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                               â”‚
â”‚  â€¢ Hide navigation items by role                                 â”‚
â”‚  â€¢ Redirect unauthorized routes to /overlook                     â”‚
â”‚  â€¢ UX convenience only - NOT a security boundary                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                              â”‚
                              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LAYER 2: API MIDDLEWARE                                         â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                               â”‚
â”‚  â€¢ Verify JWT signature and expiration                          â”‚
â”‚  â€¢ Check role against endpoint requirements                      â”‚
â”‚  â€¢ Return 403 if unauthorized                                   â”‚
â”‚  â€¢ TRUE security boundary                                        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                              â”‚
                              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LAYER 3: FIELD-LEVEL FILTERING                                  â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                               â”‚
â”‚  â€¢ Shape response based on role                                  â”‚
â”‚  â€¢ Hide sensitive fields (rates, margins)                        â”‚
â”‚  â€¢ Scope queries (Tech sees only assigned tasks)                 â”‚
â”‚  â€¢ Data-level security                                           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### 4.2 Frontend Route Guards

**Route Configuration:**

```typescript
const routes = [
  // Public routes
  { path: '/login', auth: false },
  { path: '/forgot-password', auth: false },
  { path: '/reset-password/:token', auth: false },
  
  // All authenticated users
  { path: '/overlook', auth: true, roles: ['tech', 'pm', 'admin'] },
  { path: '/quests', auth: true, roles: ['tech', 'pm', 'admin'] },
  { path: '/quests/:id', auth: true, roles: ['tech', 'pm', 'admin'] },
  { path: '/patrons', auth: true, roles: ['tech', 'pm', 'admin'] },
  { path: '/patrons/:id', auth: true, roles: ['tech', 'pm', 'admin'] },
  // ... etc
  
  // PM and Admin only
  { path: '/pacts/new', auth: true, roles: ['pm', 'admin'] },
  { path: '/runes/new', auth: true, roles: ['pm', 'admin'] },
  { path: '/rituals/new', auth: true, roles: ['pm', 'admin'] },
  
  // Admin only
  { path: '/settings/team', auth: true, roles: ['admin'] },
  { path: '/settings/system', auth: true, roles: ['admin'] },
  { path: '/reports/profitability', auth: true, roles: ['admin'] },
];
```

**Guard Behavior:**
- Unauthenticated â†’ Redirect to `/login`
- Wrong role â†’ Redirect to `/overlook` with toast: "You don't have access to that page"

### 4.3 API Middleware

**Endpoint Protection Decorator Pattern:**

```typescript
// Endpoint definitions
@RequireAuth()  // Any authenticated user
GET /clients

@RequireAuth()
@RequireRole('pm', 'admin')  // PM or Admin only
POST /tasks

@RequireAuth()
@RequireRole('admin')  // Admin only
GET /reports/profitability

@RequireAuth()
@RequireOwnerOrRole('admin')  // Owner of resource OR Admin
PATCH /users/:id
```

**Middleware Chain:**
```
Request â†’ AuthMiddleware â†’ RoleMiddleware â†’ Controller
              â”‚                   â”‚
              â–¼                   â–¼
         Verify JWT          Check role
         Extract user        against requirement
         Attach to request   403 if denied
```

### 4.4 Field-Level Filtering

**Response Shaping by Role:**

| Field | Tech | PM | Admin |
|-------|:----:|:--:|:-----:|
| `client.hourly_rate` | âŒ | âœ… | âœ… |
| `client.retainer_hours` | âŒ | âœ… | âœ… |
| `project.budget_hours` | âŒ | âœ… | âœ… |
| `project.budget_amount` | âŒ | âŒ | âœ… |
| `hosting_plan.monthly_cost` | âŒ | âŒ | âœ… |
| `hosting_plan.margin` | âŒ | âŒ | âœ… |
| `user.hourly_cost` | âŒ | âŒ | âœ… |
| `report.profitability` | âŒ | âŒ | âœ… |

**Implementation:**
```typescript
// Response transformer
function shapeClientResponse(client, userRole) {
  const base = {
    id: client.id,
    business_name: client.business_name,
    contact_person: client.contact_person,
    email: client.email,
    // ... common fields
  };
  
  if (userRole === 'pm' || userRole === 'admin') {
    base.hourly_rate = client.hourly_rate;
    base.retainer_hours = client.retainer_hours;
  }
  
  if (userRole === 'admin') {
    base.contract_link = client.contract_link;
  }
  
  return base;
}
```

### 4.5 Query Scoping

**Tech Role Restrictions:**

| Entity | Tech Can See |
|--------|--------------|
| Tasks | Only assigned to them, OR on projects they're assigned to |
| Time Entries | Only their own |
| Projects | Only those they're assigned to (via project_team_assignments) |
| Clients/Sites | All (but no billing info) |

**Implementation:**
```typescript
// Task list query for Tech
if (user.role === 'tech') {
  query.where(or(
    eq(tasks.assignee_id, user.id),
    exists(
      select().from(projectTeamAssignments)
        .where(and(
          eq(projectTeamAssignments.project_id, tasks.project_id),
          eq(projectTeamAssignments.user_id, user.id)
        ))
    )
  ));
}
```

---

## 5. Password Reset Flow

### 5.1 Reset Request Flow

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  PASSWORD RESET FLOW                             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  â”‚  User    â”‚    â”‚ Frontend â”‚    â”‚   API    â”‚    â”‚  Email   â”‚
  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜
       â”‚               â”‚               â”‚               â”‚
       â”‚ Enter email   â”‚               â”‚               â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚               â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚ POST /auth/   â”‚               â”‚
       â”‚               â”‚ forgot-passwordâ”‚              â”‚
       â”‚               â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚               â”œâ”€â”€ Find user   â”‚
       â”‚               â”‚               â”œâ”€â”€ Generate    â”‚
       â”‚               â”‚               â”‚   token       â”‚
       â”‚               â”‚               â”œâ”€â”€ Store hash  â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚               â”‚  Send email   â”‚
       â”‚               â”‚               â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚  200 OK       â”‚               â”‚
       â”‚               â”‚  (always,     â”‚               â”‚
       â”‚               â”‚   even if     â”‚               â”‚
       â”‚               â”‚   not found)  â”‚               â”‚
       â”‚               â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚ "Check email" â”‚               â”‚               â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚               â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚                    Email received             â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚ Click link    â”‚               â”‚               â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚               â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚ GET /reset-   â”‚               â”‚
       â”‚               â”‚ password/:tokenâ”‚              â”‚
       â”‚               â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚               â”œâ”€â”€ Validate    â”‚
       â”‚               â”‚               â”‚   token       â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚  Token valid  â”‚               â”‚
       â”‚               â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚ Show password â”‚               â”‚               â”‚
       â”‚ form          â”‚               â”‚               â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚               â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚ Submit new    â”‚               â”‚               â”‚
       â”‚ password      â”‚               â”‚               â”‚
       â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚               â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚ POST /auth/   â”‚               â”‚
       â”‚               â”‚ reset-passwordâ”‚               â”‚
       â”‚               â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€>â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚               â”œâ”€â”€ Validate    â”‚
       â”‚               â”‚               â”œâ”€â”€ Update pwd  â”‚
       â”‚               â”‚               â”œâ”€â”€ Invalidate  â”‚
       â”‚               â”‚               â”‚   token       â”‚
       â”‚               â”‚               â”œâ”€â”€ Revoke all  â”‚
       â”‚               â”‚               â”‚   sessions    â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚               â”‚  200 OK       â”‚               â”‚
       â”‚               â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚               â”‚
       â”‚               â”‚               â”‚               â”‚
       â”‚ Redirect to   â”‚               â”‚               â”‚
       â”‚ login         â”‚               â”‚               â”‚
       â”‚<â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚               â”‚               â”‚
```

### 5.2 Security Guardrails

| Guardrail | Implementation |
|-----------|----------------|
| **Token Expiry** | 1 hour from generation |
| **Single Use** | Token invalidated after use |
| **Cryptographic Token** | 32-byte random, URL-safe base64 |
| **Store Hash Only** | Database stores SHA-256 hash of token |
| **Email Enumeration Prevention** | Same response whether email exists or not |
| **Rate Limiting** | Max 3 reset requests per email per hour |
| **Session Invalidation** | All existing sessions revoked on password change |

### 5.3 Database Storage

```sql
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

-- Cleanup job: delete expired tokens daily
```

### 5.4 Email Template

**Subject:** Reset your Indelible password

**Body:**
```
Hi {name},

We received a request to reset your password for Indelible.

Click the link below to set a new password:
{reset_link}

This link expires in 1 hour.

If you didn't request this, you can safely ignore this email.

â€” The Indelible Team
```

---

## 6. Additional Security Considerations

### 6.1 Failed Login Handling

| Attempt Count | Response |
|---------------|----------|
| 1-4 | Normal "Invalid credentials" error |
| 5 | Account locked for 15 minutes + email notification |
| 10+ (across lockouts) | Account locked until admin intervention |

**Implementation:**
```sql
-- Track in users table
ALTER TABLE users ADD COLUMN failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMPTZ;
```

### 6.2 Role Change Handling

**When Admin changes a user's role:**
1. Update role in database
2. Revoke all existing sessions for that user
3. User must re-login to get new token with updated role

This prevents stale permissions in active sessions.

### 6.3 Account Deactivation

**When Admin deactivates a user:**
1. Set `is_active = false` in database
2. Revoke all sessions immediately
3. Any token refresh attempts fail with 403
4. Login attempts return "Account has been deactivated"

### 6.4 Audit Logging

**Security Events to Log:**

| Event | Data Captured |
|-------|---------------|
| `auth.login.success` | user_id, ip, device, timestamp |
| `auth.login.failed` | email_attempted, ip, timestamp |
| `auth.logout` | user_id, session_id, timestamp |
| `auth.password.reset_request` | user_id, ip, timestamp |
| `auth.password.reset_complete` | user_id, timestamp |
| `auth.session.revoked` | user_id, session_id, revoked_by, timestamp |
| `auth.role.changed` | user_id, old_role, new_role, changed_by |

---

## 7. Implementation Checklist

### 7.1 Database Additions

```sql
-- User sessions table
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(64) NOT NULL,
  device_info JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at) 
  WHERE revoked_at IS NULL;

-- Password reset tokens table
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_reset_tokens_user ON password_reset_tokens(user_id);

-- User lockout fields
ALTER TABLE users ADD COLUMN failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMPTZ;

-- Audit log table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  ip_address INET,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_event ON audit_logs(event_type);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

### 7.2 API Endpoints Summary

| Endpoint | Method | Access | Purpose |
|----------|--------|--------|---------|
| `/auth/login` | POST | Public | Authenticate user |
| `/auth/logout` | POST | Auth | End current session |
| `/auth/refresh` | POST | Cookie | Get new access token |
| `/auth/forgot-password` | POST | Public | Request reset email |
| `/auth/reset-password` | POST | Public + Token | Set new password |
| `/auth/validate-reset-token` | GET | Public | Check token validity |

### 7.3 Environment Variables

```env
# JWT Configuration
JWT_SECRET=<32+ character secret>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
JWT_REFRESH_EXPIRY_REMEMBER=30d

# Cookie Configuration
COOKIE_DOMAIN=indelible.agency
COOKIE_SECURE=true
COOKIE_SAME_SITE=strict

# Security
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
RESET_TOKEN_EXPIRY_HOURS=1

# Email (for password reset)
SMTP_HOST=...
SMTP_FROM=noreply@indelible.agency
```

---

## 8. Summary

| Aspect | Decision |
|--------|----------|
| **Auth Method** | Email/password (SSO future enhancement) |
| **Token Strategy** | Access (15min) + Refresh (7-30 days) |
| **Token Storage** | httpOnly cookies |
| **Session Tracking** | Database table with device info |
| **Role Enforcement** | 3 layers: route guards, API middleware, field filtering |
| **Password Reset** | 1-hour token, email enumeration protected |
| **Lockout Policy** | 5 failed attempts â†’ 15 min lockout |
| **Audit Logging** | All auth events captured |

---

## Related Documents

- `indelible-app-architecture.md` â€” Technical architecture and role permissions matrix
- `indelible-api-endpoint-inventory.md` â€” Complete API specification
- `indelible-data-model-refinement.md` â€” Database schema
- `indelible-state-management-plan.md` â€” Frontend state architecture
- `indelible-screen-inventory.md` â€” Login and auth-related screens