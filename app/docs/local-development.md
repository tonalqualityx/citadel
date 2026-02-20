# Local Development Guide

This guide explains how to set up and run Citadel for local development using PostgreSQL (matching production).

## Prerequisites

- **Node.js** 20+ (recommended: use nvm)
- **npm** or **pnpm**
- **Docker** and **Docker Compose** (for PostgreSQL)
- **Git**

### Installing Prerequisites

**Docker:**
- macOS: `brew install --cask docker` or [Docker Desktop](https://www.docker.com/products/docker-desktop)
- Linux: [Install Docker Engine](https://docs.docker.com/engine/install/)
- Windows: [Docker Desktop](https://www.docker.com/products/docker-desktop)

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```

3. **Set up the database (one-time):**
   ```bash
   npm run db:setup
   ```
   This will:
   - Start the PostgreSQL Docker container
   - Run database migrations
   - Generate the Prisma client
   - Seed the database with initial data

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open the app:**
   Navigate to http://localhost:3000

   Default login credentials:
   - Email: `admin@citadel.local`
   - Password: `admin123`

## Database Management

### Start the Database
```bash
npm run db:up
```

### Stop the Database
```bash
npm run db:down
```

### Reset the Database (⚠️ Destroys all data)
```bash
npm run db:reset
```

### Re-seed the Database
```bash
npm run db:seed
```

### Open Prisma Studio
```bash
npm run db:studio
```
Prisma Studio provides a visual interface to browse and edit database records at http://localhost:5555

### Run Migrations
```bash
npm run db:migrate
```

## Running Tests

### Unit Tests (Vitest)
```bash
npm run test          # Interactive mode
npm run test:run      # Run once and exit
```

### E2E Tests (Playwright)
```bash
npm run test:e2e          # Headless mode
npm run test:e2e:ui       # With UI
npm run test:e2e:headed   # With browser visible
```

## Troubleshooting

### Database connection errors

**Problem:** `Error: P1001: Can't reach database server`

**Solution:**
1. Ensure Docker is running: `docker ps`
2. Start the database: `npm run db:up`
3. Wait a few seconds for PostgreSQL to initialize
4. Check container status: `docker compose logs postgres`

### Port 5432 already in use

**Problem:** `bind: address already in use`

**Solution:**
1. Check what's using port 5432: `lsof -i :5432`
2. Stop the other PostgreSQL instance or change the port in `docker-compose.yml`

### Prisma Client errors

**Problem:** `Error: Cannot find module '@prisma/client'`

**Solution:**
```bash
npm run db:generate
```

### Migration conflicts

**Problem:** Database schema out of sync

**Solution:**
```bash
# Reset database (loses all data)
npm run db:reset

# Or manually sync
npm run db:down
npm run db:up
npx prisma migrate dev
```

## Project Structure

```
citadel/app/
├── app/                 # Next.js app directory
├── components/          # React components
├── lib/                 # Utility functions, API clients
├── prisma/              # Database schema and migrations
│   ├── schema.prisma    # Main schema (PostgreSQL)
│   ├── schema.sqlite.prisma  # SQLite backup (legacy)
│   ├── migrations/      # Database migrations
│   └── seed.ts          # Database seeding
├── scripts/             # Utility scripts
│   └── setup-local-db.sh
├── docs/                # Documentation
├── __tests__/           # Test files
└── docker-compose.yml   # PostgreSQL container config
```

## Environment Variables

Key variables in `.env.local`:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://citadel:citadel@localhost:5432/citadel_dev` |
| `JWT_SECRET` | JWT signing secret | Change in production |
| `NEXTAUTH_SECRET` | NextAuth.js secret | Change in production |
| `NEXTAUTH_URL` | App URL | `http://localhost:3000` |

## Switching Back to SQLite (Not Recommended)

If you need to use SQLite temporarily (not recommended as it differs from production):

1. Update `.env.local`:
   ```
   DATABASE_URL="file:./dev.db"
   ```

2. Switch schema:
   ```bash
   cp prisma/schema.sqlite.prisma prisma/schema.prisma
   ```

3. Regenerate Prisma client:
   ```bash
   npm run db:generate
   ```

## Getting Help

- Check [README.md](../README.md) for project overview
- Review [CLAUDE.md](../CLAUDE.md) for AI assistant context
- Open an issue if you encounter problems
