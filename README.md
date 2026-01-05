# Citadel

Project management for web agencies, built with neurodivergent teams in mind.

## Features

- **Projects & Tasks** - Track work with phases, milestones, and detailed task management
- **Time Tracking** - Built-in timeclock with retainer tracking and billing reports
- **Clients & Sites** - Manage client relationships, domains, and hosting
- **Recipes & SOPs** - Reusable templates for common workflows
- **Energy Estimates** - Task estimation using energy levels + mystery factors instead of just hours
- **Battery Impact** - Track cognitive load to prevent burnout on taxing tasks
- **Team Management** - Role-based access (Admin, PM, Tech) with function assignments

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL with Prisma ORM
- **Styling**: Tailwind CSS with custom theme system (light/dim/dark modes)
- **State**: TanStack Query (React Query)
- **Auth**: JWT with HTTP-only refresh tokens
- **File Storage**: AWS S3 (production) / local filesystem (development)

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- npm

### Development Setup

```bash
cd app
cp .env.example .env
# Edit .env with your database credentials

npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Default login: `admin@indelible.agency` / `password123`

### Environment Variables

```bash
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/indelible_dev"
JWT_SECRET="min-32-character-secret"
JWT_REFRESH_SECRET="another-min-32-char-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Optional (production)
AWS_S3_BUCKET="your-bucket"
AWS_REGION="us-east-2"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
CRON_SECRET="for-scheduled-jobs"
```

## Project Structure

```
citadel/
├── app/                    # Next.js application
│   ├── app/               # App router pages & API routes
│   ├── components/        # React components
│   │   ├── ui/           # Base UI components
│   │   └── domain/       # Feature-specific components
│   ├── lib/              # Utilities, hooks, services
│   └── prisma/           # Database schema & migrations
└── implementation/        # Planning docs & notes
```

## Deployment

Production deployment uses:
- AWS EC2 (app server)
- AWS RDS (PostgreSQL)
- AWS S3 (file uploads)
- GitHub Actions (CI/CD)

See `.github/workflows/deploy.yml` for the deployment pipeline.

## License

Proprietary - All rights reserved.
