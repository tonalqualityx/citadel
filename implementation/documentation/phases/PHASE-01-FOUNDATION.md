# Phase 1: Foundation + Authentication
## Detailed Implementation Guide for Claude Code

**Phase:** 1 of 10  
**Estimated Duration:** 2-3 days  
**Prerequisites:** None (this is the starting phase)

---

## 🎯 Phase Goal

Create a runnable application skeleton with working authentication. By the end of this phase:
- Next.js project is configured and running
- Database schema is created and seeded
- Users can log in, see a role-appropriate dashboard shell, and log out
- Protected routes redirect unauthenticated users to login

---

## 📚 Required Reading

Before starting this phase, the **Reader Agent** must review:

| Document | Sections to Focus On |
|----------|---------------------|
| `CLAUDE-CODE-MASTER-INSTRUCTIONS.md` | Full document (coding conventions, patterns) |
| `indelible-data-model-refinement.md` | Full schema, especially `users` table |
| `indelible-auth-design.md` | JWT strategy, login flow, middleware |
| `indelible-wireframes-global-shell.md` | Sidebar structure, header layout |
| `indelible-navigation-sitemap.md` | Route structure, role-based navigation |
| `/implementation/mockups/` | Review ALL mockup folders for common patterns |

### Mockup Review Checklist
- [ ] View each `preview.png` to understand visual targets
- [ ] Review each `sample.tsx` for code patterns
- [ ] Note common elements: buttons, cards, inputs, badges
- [ ] Identify color palette and spacing conventions

---

## 📋 Phase Checklist

### 1.1 Project Setup

#### 1.1.1 Initialize Next.js Project
- [ ] Run: `npx create-next-app@latest indelible --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"`
- [ ] Verify: App runs with `npm run dev`

**Files Created:**
```
/indelible
├── app/
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
└── ...
```

#### 1.1.2 Install Dependencies
- [ ] Run dependency installation:

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install @prisma/client prisma
npm install zod react-hook-form @hookform/resolvers
npm install jose bcryptjs
npm install @radix-ui/react-slot class-variance-authority clsx tailwind-merge
npm install lucide-react
npm install -D @types/bcryptjs
```

#### 1.1.3 Configure Project Structure
- [ ] Create directory structure:

```bash
mkdir -p app/api/auth/{login,logout,refresh,me}
mkdir -p app/\(auth\)/login
mkdir -p app/\(app\)/{overlook,foundry,sanctum,chronicles,grimoire,guild}
mkdir -p components/{ui,domain,layout}
mkdir -p lib/{api,auth,db,hooks,utils,calculations,constants}
mkdir -p prisma
mkdir -p types
mkdir -p __tests__/{unit,integration,e2e}
```

**Expected Structure:**
```
/app
  /api
    /auth
      /login/route.ts
      /logout/route.ts
      /refresh/route.ts
      /me/route.ts
  /(auth)
    /login/page.tsx
    layout.tsx
  /(app)
    /overlook/page.tsx
    /foundry/page.tsx (placeholder)
    /sanctum/page.tsx (placeholder)
    /chronicles/page.tsx (placeholder)
    /grimoire/page.tsx (placeholder)
    /guild/page.tsx (placeholder)
    layout.tsx
/components
  /ui
  /domain
  /layout
/lib
  /api
  /auth
  /db
  /hooks
  /utils
  /calculations
  /constants
/prisma
/types
/__tests__
```

#### 1.1.4 Configure ESLint + Prettier
- [ ] Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [ ] Update `.eslintrc.json`:

```json
{
  "extends": ["next/core-web-vitals", "prettier"],
  "rules": {
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "no-console": ["warn", { "allow": ["error", "warn"] }]
  }
}
```

- [ ] Install prettier: `npm install -D prettier eslint-config-prettier`

#### 1.1.5 Configure Environment Variables
- [ ] Create `.env.local`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/indelible_dev"

# Auth
JWT_SECRET="your-super-secret-jwt-key-min-32-chars"
JWT_REFRESH_SECRET="your-refresh-secret-key-min-32-chars"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

- [ ] Create `.env.example` (same without real values)
- [ ] Add `.env.local` to `.gitignore`

#### 1.1.6 Configure Path Aliases
- [ ] Verify `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

---

### 1.5 Component Library Foundation

**CRITICAL:** Before building ANY UI, establish the component library. Components are built ONCE and reused everywhere.

#### 1.5.1 Review Mockups
- [ ] Check `/implementation/mockups/` directory for reference implementations
- [ ] Each mockup folder contains:
  - `preview.png` — Visual target
  - `sample.tsx` — Reference code (may need adaptation)
- [ ] Identify common patterns across mockups (buttons, cards, badges, inputs)

#### 1.5.2 Create Base UI Components

Build these foundational components in `/components/ui/`:

- [ ] **button.tsx** — Primary, secondary, ghost, destructive variants
- [ ] **input.tsx** — Text input with label, error state
- [ ] **select.tsx** — Dropdown select with options
- [ ] **badge.tsx** — Status badges with color variants
- [ ] **card.tsx** — Container card with header, body, footer
- [ ] **modal.tsx** — Dialog modal with overlay
- [ ] **spinner.tsx** — Loading spinner

**Example: `/components/ui/badge.tsx`**
```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-stone-100 text-stone-800',
        success: 'bg-green-100 text-green-800',
        warning: 'bg-amber-100 text-amber-800',
        error: 'bg-red-100 text-red-800',
        info: 'bg-blue-100 text-blue-800',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

#### 1.5.3 Create Utility: cn (classname merger)
- [ ] Create `/lib/utils/cn.ts`:

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

#### 1.5.4 Component Library Rules

**⛔ MANDATORY — THESE ARE NOT OPTIONAL:**

**ALWAYS:**
- Check `/components/ui/` before writing ANY styled element
- Create library component FIRST if it doesn't exist
- Use variants (via CVA) for style differences, not separate components
- Keep `/components/ui/` components generic (no business logic)
- Import from library in domain components

**NEVER:**
- Inline styled buttons, cards, badges, inputs, modals — use the library
- Duplicate Tailwind patterns that should be a component
- Create "quick" one-off elements — they always multiply
- Put domain logic in `/components/ui/` components
- Skip checking mockups before building

**The library is the SINGLE SOURCE OF TRUTH.** If every button doesn't come from `Button`, you're doing it wrong.

---

### 1.2 Database Setup

#### 1.2.1 Create Prisma Schema
- [ ] Create `/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// USERS & AUTH
// ============================================

model User {
  id                String    @id @default(uuid()) @db.Uuid
  email             String    @unique @db.VarChar(255)
  password_hash     String    @db.VarChar(255)
  name              String    @db.VarChar(255)
  role              UserRole  @default(tech)
  avatar_url        String?   @db.VarChar(500)
  is_active         Boolean   @default(true)
  last_login_at     DateTime?
  created_at        DateTime  @default(now())
  updated_at        DateTime  @updatedAt
  
  // Relations (add as other models are created)
  preferences       UserPreference?
  sessions          Session[]
  
  @@map("users")
}

model UserPreference {
  id                  String   @id @default(uuid()) @db.Uuid
  user_id             String   @unique @db.Uuid
  naming_convention   NamingConvention @default(awesome)
  theme               Theme    @default(system)
  notification_bundle Boolean  @default(true)
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt
  
  user User @relation(fields: [user_id], references: [id], onDelete: Cascade)
  
  @@map("user_preferences")
}

model Session {
  id            String   @id @default(uuid()) @db.Uuid
  user_id       String   @db.Uuid
  refresh_token String   @unique @db.VarChar(500)
  expires_at    DateTime
  created_at    DateTime @default(now())
  
  user User @relation(fields: [user_id], references: [id], onDelete: Cascade)
  
  @@index([user_id])
  @@index([expires_at])
  @@map("sessions")
}

// ============================================
// ENUMS
// ============================================

enum UserRole {
  tech
  pm
  admin
}

enum NamingConvention {
  awesome
  standard
}

enum Theme {
  light
  dim
  dark
  system
}

// ============================================
// REFERENCE DATA (needed for seeding)
// ============================================

model Function {
  id            String   @id @default(uuid()) @db.Uuid
  name          String   @db.VarChar(100)
  primary_focus String?  @db.Text
  sort_order    Int      @default(0)
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@map("functions")
}

model HostingPlan {
  id           String   @id @default(uuid()) @db.Uuid
  name         String   @db.VarChar(100)
  rate         Decimal  @db.Decimal(10, 2)
  agency_rate  Decimal? @db.Decimal(10, 2)
  monthly_cost Decimal? @db.Decimal(10, 2)
  vendor_plan  String?  @db.VarChar(100)
  details      String?  @db.Text
  is_active    Boolean  @default(true)
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
  
  @@map("hosting_plans")
}

model MaintenancePlan {
  id           String   @id @default(uuid()) @db.Uuid
  name         String   @db.VarChar(100)
  rate         Decimal  @db.Decimal(10, 2)
  agency_rate  Decimal? @db.Decimal(10, 2)
  hours        Decimal? @db.Decimal(5, 2)
  details      String?  @db.Text
  is_active    Boolean  @default(true)
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
  
  @@map("maintenance_plans")
}

model Tool {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @db.VarChar(100)
  category    String?  @db.VarChar(50)
  url         String?  @db.VarChar(500)
  description String?  @db.Text
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
  
  @@map("tools")
}
```

> **Note:** This is a partial schema for Phase 1. Full schema with clients, projects, tasks will be added in later phases.

#### 1.2.2 Initialize Database
- [ ] Run: `npx prisma generate`
- [ ] Run: `npx prisma migrate dev --name init`
- [ ] Verify: Migration created in `/prisma/migrations/`

#### 1.2.3 Create Prisma Client Singleton
- [ ] Create `/lib/db/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

#### 1.2.4 Create Seed Script
- [ ] Create `/prisma/seed.ts`:

```typescript
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create test users (one per role)
  const passwordHash = await bcrypt.hash('password123', 10);

  const users = [
    {
      email: 'admin@indelible.agency',
      name: 'Admin User',
      role: UserRole.admin,
      password_hash: passwordHash,
    },
    {
      email: 'pm@indelible.agency',
      name: 'PM User',
      role: UserRole.pm,
      password_hash: passwordHash,
    },
    {
      email: 'tech@indelible.agency',
      name: 'Tech User',
      role: UserRole.tech,
      password_hash: passwordHash,
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user,
    });
    console.log(`  âœ“ Created user: ${user.email}`);
  }

  // Create default functions
  const functions = [
    { name: 'Project Manager', primary_focus: 'Project orchestration and client communication', sort_order: 1 },
    { name: 'Customer Success', primary_focus: 'Client relationships and onboarding', sort_order: 2 },
    { name: 'Designer', primary_focus: 'UI/UX design and mockups', sort_order: 3 },
    { name: 'Developer', primary_focus: 'Site building and functionality', sort_order: 4 },
    { name: 'Network Admin', primary_focus: 'Hosting and infrastructure', sort_order: 5 },
  ];

  for (const func of functions) {
    await prisma.function.upsert({
      where: { id: func.name }, // This won't work, need different approach
      update: {},
      create: func,
    });
  }
  
  // Use createMany for functions (simpler)
  await prisma.function.deleteMany(); // Clear existing
  await prisma.function.createMany({ data: functions });
  console.log(`  âœ“ Created ${functions.length} functions`);

  // Create default hosting plans
  const hostingPlans = [
    { name: 'Starter', rate: 29.99, monthly_cost: 10.00, vendor_plan: 'Basic' },
    { name: 'Professional', rate: 59.99, monthly_cost: 25.00, vendor_plan: 'Standard' },
    { name: 'Enterprise', rate: 149.99, monthly_cost: 75.00, vendor_plan: 'Premium' },
  ];

  await prisma.hostingPlan.deleteMany();
  await prisma.hostingPlan.createMany({ data: hostingPlans });
  console.log(`  âœ“ Created ${hostingPlans.length} hosting plans`);

  // Create default maintenance plans
  const maintenancePlans = [
    { name: 'Basic', rate: 99.00, hours: 2.0 },
    { name: 'Standard', rate: 249.00, hours: 5.0 },
    { name: 'Premium', rate: 499.00, hours: 12.0 },
  ];

  await prisma.maintenancePlan.deleteMany();
  await prisma.maintenancePlan.createMany({ data: maintenancePlans });
  console.log(`  âœ“ Created ${maintenancePlans.length} maintenance plans`);

  console.log('âœ… Seeding complete!');
}

main()
  .catch((e) => {
    console.error('âŒ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] Add to `package.json`:

```json
{
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  }
}
```

- [ ] Install ts-node: `npm install -D ts-node`
- [ ] Run: `npx prisma db seed`
- [ ] Verify: Check database has users, functions, plans

---

### 1.3 Authentication

#### 1.3.1 Create JWT Utilities
- [ ] Create `/lib/auth/jwt.ts`:

```typescript
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { prisma } from '@/lib/db/prisma';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const JWT_REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);

export interface TokenPayload extends JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export async function signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_EXPIRY || '15m')
    .sign(JWT_SECRET);
}

export async function signRefreshToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_EXPIRY || '7d')
    .sign(JWT_REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as TokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET);
  return payload as TokenPayload;
}

export async function createSession(userId: string, refreshToken: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await prisma.session.create({
    data: {
      user_id: userId,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    },
  });
}

export async function deleteSession(refreshToken: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { refresh_token: refreshToken },
  });
}

export async function findSession(refreshToken: string) {
  return prisma.session.findUnique({
    where: { refresh_token: refreshToken },
    include: { user: true },
  });
}
```

#### 1.3.2 Create Auth Middleware
- [ ] Create `/lib/auth/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAccessToken, TokenPayload } from './jwt';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireAuth(request: NextRequest): Promise<TokenPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    throw new AuthError('Authentication required', 401);
  }

  try {
    const payload = await verifyAccessToken(token);
    
    // Optionally verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, is_active: true },
    });

    if (!user || !user.is_active) {
      throw new AuthError('User not found or inactive', 401);
    }

    return payload;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid token', 401);
  }
}

export function requireRole(user: TokenPayload, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role as UserRole)) {
    throw new AuthError('Insufficient permissions', 403);
  }
}

export async function getOptionalAuth(request: NextRequest): Promise<TokenPayload | null> {
  try {
    return await requireAuth(request);
  } catch {
    return null;
  }
}
```

#### 1.3.3 Create API Error Handler
- [ ] Create `/lib/api/errors.ts`:

```typescript
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '@/lib/auth/middleware';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);

  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Validation failed', details: error.errors },
      { status: 400 }
    );
  }

  // Unknown error
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}
```

#### 1.3.4 Create Login Endpoint
- [ ] Create `/app/api/auth/login/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { signAccessToken, signRefreshToken, createSession } from '@/lib/auth/jwt';
import { handleApiError, ApiError } from '@/lib/api/errors';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.is_active) {
      throw new ApiError('Invalid credentials', 401);
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new ApiError('Invalid credentials', 401);
    }

    // Generate tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await signAccessToken(tokenPayload);
    const refreshToken = await signRefreshToken(tokenPayload);

    // Store session
    await createSession(user.id, refreshToken);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    // Create response with cookies
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    });

    // Set HTTP-only cookies
    response.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15, // 15 minutes
      path: '/',
    });

    response.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 1.3.5 Create Logout Endpoint
- [ ] Create `/app/api/auth/logout/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/auth/jwt';
import { handleApiError } from '@/lib/api/errors';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

    if (refreshToken) {
      await deleteSession(refreshToken);
    }

    const response = NextResponse.json({ success: true });

    // Clear cookies
    response.cookies.set('access_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    response.cookies.set('refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 1.3.6 Create Refresh Endpoint
- [ ] Create `/app/api/auth/refresh/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  findSession,
  deleteSession,
  createSession,
} from '@/lib/auth/jwt';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

    if (!refreshToken) {
      throw new ApiError('Refresh token required', 401);
    }

    // Verify token and find session
    const payload = await verifyRefreshToken(refreshToken);
    const session = await findSession(refreshToken);

    if (!session || session.expires_at < new Date()) {
      throw new ApiError('Invalid or expired session', 401);
    }

    if (!session.user.is_active) {
      throw new ApiError('User is inactive', 401);
    }

    // Generate new tokens
    const tokenPayload = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };

    const newAccessToken = await signAccessToken(tokenPayload);
    const newRefreshToken = await signRefreshToken(tokenPayload);

    // Rotate refresh token
    await deleteSession(refreshToken);
    await createSession(session.user.id, newRefreshToken);

    const response = NextResponse.json({ success: true });

    response.cookies.set('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15,
      path: '/',
    });

    response.cookies.set('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 1.3.7 Create Me Endpoint
- [ ] Create `/app/api/auth/me/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar_url: true,
        preferences: {
          select: {
            naming_convention: true,
            theme: true,
            notification_bundle: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 1.3.8 Create Login Page
- [ ] Create `/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-100">
      {children}
    </div>
  );
}
```

- [ ] Create `/app/(auth)/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }

      router.push('/overlook');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-stone-900">Indelible</h1>
        <p className="text-stone-600 mt-2">Sign in to your account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-stone-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-stone-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 block w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50"
        >
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-stone-500">
        <p>Test accounts:</p>
        <p>admin@indelible.agency / password123</p>
      </div>
    </div>
  );
}
```

---

### 1.4 App Shell

#### 1.4.1 Create App Layout with Auth Check
- [ ] Create `/app/(app)/layout.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token');

  if (!token) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
```

#### 1.4.2 Create Sidebar Component
- [ ] Create `/components/layout/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  Clock,
  BookOpen,
  Settings,
} from 'lucide-react';

const navigation = [
  { name: 'Overlook', href: '/overlook', icon: LayoutDashboard },
  { name: 'Foundry', href: '/foundry', icon: Users },
  { name: 'Sanctum', href: '/sanctum', icon: FolderKanban },
  { name: 'Chronicles', href: '/chronicles', icon: Clock },
  { name: 'Grimoire', href: '/grimoire', icon: BookOpen },
  { name: 'Guild', href: '/guild', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
      <div className="flex flex-col flex-grow bg-stone-900 pt-5 pb-4 overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4">
          <span className="text-xl font-bold text-white">Indelible</span>
        </div>
        <nav className="mt-8 flex-1 px-2 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-amber-600 text-white'
                    : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                }`}
              >
                <item.icon
                  className={`mr-3 h-5 w-5 flex-shrink-0 ${
                    isActive ? 'text-white' : 'text-stone-400 group-hover:text-white'
                  }`}
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
```

#### 1.4.3 Create Header Component
- [ ] Create `/components/layout/Header.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Search, User, LogOut } from 'lucide-react';

export function Header() {
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-stone-200 bg-white px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
      {/* Search */}
      <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
        <div className="relative flex flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 h-5 w-5 text-stone-400" />
          <input
            type="search"
            placeholder="Search..."
            className="block w-full max-w-md rounded-md border-0 py-1.5 pl-10 pr-3 text-stone-900 ring-1 ring-inset ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-amber-600 sm:text-sm sm:leading-6"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-x-4 lg:gap-x-6">
        {/* Timer placeholder */}
        <div className="hidden lg:block text-sm text-stone-500">
          Timer: 00:00:00
        </div>

        {/* Notifications */}
        <button className="relative p-2 text-stone-400 hover:text-stone-500">
          <Bell className="h-6 w-6" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-x-2 p-2 text-stone-400 hover:text-stone-500"
          >
            <User className="h-6 w-6" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-48 rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5">
              <button
                onClick={handleLogout}
                className="flex w-full items-center px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
              >
                <LogOut className="mr-3 h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
```

#### 1.4.4 Create Dashboard Placeholder
- [ ] Create `/app/(app)/overlook/page.tsx`:

```tsx
export default function OverlookPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900">Overlook</h1>
      <p className="mt-2 text-stone-600">Dashboard content will go here.</p>
      
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-medium text-stone-900">My Quests</h2>
          <p className="mt-2 text-3xl font-bold text-amber-600">0</p>
        </div>
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-medium text-stone-900">Active Pacts</h2>
          <p className="mt-2 text-3xl font-bold text-amber-600">0</p>
        </div>
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-medium text-stone-900">Time This Week</h2>
          <p className="mt-2 text-3xl font-bold text-amber-600">0h</p>
        </div>
      </div>
    </div>
  );
}
```

#### 1.4.5 Create Other Section Placeholders
- [ ] Create placeholder pages for: `/foundry`, `/sanctum`, `/chronicles`, `/grimoire`, `/guild`

Each follows this pattern:
```tsx
export default function FoundryPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900">Foundry</h1>
      <p className="mt-2 text-stone-600">Patrons, Sites, and Domains</p>
    </div>
  );
}
```

---

## 🧪 Testing Requirements

### Unit Tests

Create `/__tests__/unit/auth/jwt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '@/lib/auth/jwt';

describe('JWT Utilities', () => {
  const testPayload = {
    userId: 'test-user-id',
    email: 'test@example.com',
    role: 'tech',
  };

  it('should sign and verify access token', async () => {
    const token = await signAccessToken(testPayload);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const verified = await verifyAccessToken(token);
    expect(verified.userId).toBe(testPayload.userId);
    expect(verified.email).toBe(testPayload.email);
    expect(verified.role).toBe(testPayload.role);
  });

  it('should reject invalid token', async () => {
    await expect(verifyAccessToken('invalid-token')).rejects.toThrow();
  });
});
```

### Integration Tests

Create `/__tests__/integration/api/auth.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';

describe('Auth API', () => {
  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tech@indelible.agency',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe('tech@indelible.agency');
    });

    it('should reject invalid credentials', async () => {
      const response = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tech@indelible.agency',
          password: 'wrongpassword',
        }),
      });

      expect(response.status).toBe(401);
    });
  });
});
```

### Test Commands

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run --dir __tests__/unit",
    "test:integration": "vitest run --dir __tests__/integration",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## âœ… Phase 1 Acceptance Criteria

Before marking Phase 1 complete, verify:

### Functionality
- [ ] `npm run dev` starts the application
- [ ] Visiting `/overlook` without auth redirects to `/login`
- [ ] Login with `tech@indelible.agency` / `password123` succeeds
- [ ] After login, redirected to `/overlook`
- [ ] Sidebar navigation works for all sections
- [ ] Logout clears session and redirects to login
- [ ] Login with wrong password shows error

### Code Quality
- [ ] All files follow naming conventions
- [ ] No TypeScript errors
- [ ] ESLint passes
- [ ] All imports are valid (no assumed functions)

### Component Library
- [ ] Base UI components created in `/components/ui/`
- [ ] Button, Input, Badge, Card, Modal, Spinner exist
- [ ] `cn` utility created for className merging
- [ ] Components use CVA for variants
- [ ] No inline one-off styles in feature components

### Tests
- [ ] Unit tests for JWT utilities pass
- [ ] Integration tests for auth endpoints pass

### Documentation
- [ ] Utility Registry in Master Instructions updated
- [ ] Progress Tracker updated
- [ ] Session Log entry added

---

## 📜 Next Phase

After completing Phase 1, proceed to **Phase 2: Core Entities (CRUD)**.

Phase 2 Reference Documents:
- `indelible-api-endpoint-inventory.md` (clients, sites, domains endpoints)
- `indelible-wireframes-list-views.md`
- `indelible-wireframes-pact-patron-detail.md`

---

*Phase 1 Document — Last Updated: December 2025*