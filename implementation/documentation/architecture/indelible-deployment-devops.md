# Indelible App: Deployment & DevOps
## Phase 4.3 Operational Planning Document

**Version:** 1.1  
**Date:** December 2024  
**Status:** ✅ Complete

---

## Overview

This document covers infrastructure, deployment pipelines, and operational procedures for Indelible hosted on AWS. The approach prioritizes cost minimization while maintaining reliability.

### Design Principles

| Principle | Approach |
|-----------|----------|
| **Minimize cost** | Use free tier where possible, no external paid services |
| **Simple over clever** | EC2 + RDS, not containers or serverless |
| **Reproducible** | Infrastructure documented, scripts in repo |
| **Observable** | Know when things break before users tell you |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS PRODUCTION                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐      │
│    │   Route 53   │         │     EC2      │         │     RDS      │      │
│    │    (DNS)     │────────▶│  (App Host)  │────────▶│ (PostgreSQL) │      │
│    │              │         │              │         │              │      │
│    │              │         │ • Next.js    │         │ • pgvector   │      │
│    │              │         │ • PM2        │         │ • Sessions   │      │
│    │              │         │ • Nginx      │         │ • Auto-backup│      │
│    └──────────────┘         └──────────────┘         └──────────────┘      │
│                                    │                                        │
│                             ┌──────┴───────┐                               │
│                             │   ACM/SSL    │                               │
│                             │ (free certs) │                               │
│                             └──────────────┘                               │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                              EXTERNAL (FREE)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                │
│    │    Sentry    │    │   Resend     │    │   GitHub     │                │
│    │  (free tier) │    │ (free tier)  │    │  (CI/CD)     │                │
│    └──────────────┘    └──────────────┘    └──────────────┘                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## AWS Infrastructure

### Option A: EC2 + RDS (Recommended)

Separate database for easier backups and management.

| Resource | Spec | Monthly Cost |
|----------|------|--------------|
| EC2 | t3.small (2 GB RAM, 2 vCPU) | ~$15 |
| RDS PostgreSQL | db.t3.micro (1 GB RAM) | ~$13 |
| EBS Storage | 20 GB gp3 | ~$2 |
| Data Transfer | Minimal for 20 users | ~$1 |
| **Total** | | **~$31/mo** |

*First year: EC2 t2.micro and RDS db.t2.micro may be free tier eligible*

### Option B: Single EC2 (Lowest Cost)

Run PostgreSQL on the same EC2 instance.

| Resource | Spec | Monthly Cost |
|----------|------|--------------|
| EC2 | t3.small (2 GB RAM, 2 vCPU) | ~$15 |
| EBS Storage | 30 GB gp3 | ~$3 |
| Data Transfer | Minimal | ~$1 |
| **Total** | | **~$19/mo** |

**Trade-off:** Manual backup management, harder to scale DB independently.

### Recommendation

Start with **Option A** (EC2 + RDS). The extra ~$12/mo is worth it for:
- Automated daily backups with 7-day retention
- Point-in-time recovery
- Easier to upgrade DB independently
- No risk of app crashing and taking down database

---

## EC2 Setup

### Instance Configuration

| Setting | Value |
|---------|-------|
| AMI | Ubuntu 24.04 LTS |
| Instance Type | t3.small (upgrade to t3.medium if needed) |
| Storage | 20 GB gp3 |
| Security Group | See below |

### Security Group Rules

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | Your IP only | Server access |
| HTTP | 80 | 0.0.0.0/0 | Redirect to HTTPS |
| HTTPS | 443 | 0.0.0.0/0 | Application |
| PostgreSQL | 5432 | EC2 security group | RDS access (internal only) |

### Initial Server Setup

```bash
#!/bin/bash
# Run as root on fresh Ubuntu 24.04

# Update system
apt update && apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install Certbot for SSL
apt install -y certbot python3-certbot-nginx

# Create app user
useradd -m -s /bin/bash indelible
mkdir -p /var/www/indelible
chown indelible:indelible /var/www/indelible

# Create log directory
mkdir -p /var/log/indelible
chown indelible:indelible /var/log/indelible

# Set up firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "Server setup complete!"
```

---

## RDS PostgreSQL Setup

### Configuration

| Setting | Value |
|---------|-------|
| Engine | PostgreSQL 15 |
| Instance | db.t3.micro (or db.t4g.micro for ARM) |
| Storage | 20 GB gp3, autoscaling enabled |
| Multi-AZ | No (not needed for MVP) |
| Public Access | No |
| VPC | Same as EC2 |

### Enable pgvector Extension

After RDS instance is created:

```sql
-- Connect to database
psql -h your-rds-endpoint.region.rds.amazonaws.com -U postgres -d indelible

-- Enable pgvector (available on RDS PostgreSQL 15+)
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Connection String

```
DATABASE_URL=postgresql://postgres:PASSWORD@your-rds-endpoint.region.rds.amazonaws.com:5432/indelible
```

Store this in environment variables, never in code.

---

## PostgreSQL Sessions (No Redis)

Using PostgreSQL for session storage instead of Redis:

### Session Table Migration

```sql
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
```

### Next.js Configuration

Using `next-auth` or custom session handling with `connect-pg-simple`:

```typescript
// For custom JWT + session storage approach
// Sessions stored in PostgreSQL, JWT for stateless auth

// lib/session.ts
import { Pool } from 'pg';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PgSession = connectPgSimple(session);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
});
```

---

## Nginx Configuration

```nginx
# /etc/nginx/sites-available/indelible

server {
    listen 80;
    server_name app.indelible.agency;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.indelible.agency;
    
    # SSL certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/app.indelible.agency/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.indelible.agency/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### SSL Setup with Certbot

```bash
# Get SSL certificate (run once after DNS is configured)
certbot --nginx -d app.indelible.agency

# Auto-renewal is configured automatically
# Test renewal
certbot renew --dry-run
```

---

## Environment Strategy

### Three Environments

| Environment | Purpose | Infrastructure |
|-------------|---------|----------------|
| Development | Local development | localhost + local PostgreSQL |
| Staging | Pre-production testing | Same EC2, separate database |
| Production | Live system | EC2 + RDS |

### Environment Variables

```bash
# .env.example

# App
NODE_ENV=development|staging|production
NEXT_PUBLIC_APP_URL=https://app.indelible.agency
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/indelible

# Auth
JWT_SECRET=<random-64-chars>
JWT_REFRESH_SECRET=<different-random-64-chars>
SESSION_SECRET=<another-random-64-chars>

# Email (Resend - free tier)
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=notifications@indelible.agency

# Error Tracking (Sentry - free tier)
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

### Generate Secrets

```bash
# Generate random secrets
openssl rand -base64 48
```

---

## PM2 Configuration

```javascript
// ecosystem.config.js

module.exports = {
  apps: [{
    name: 'indelible',
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    cwd: '/var/www/indelible',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/indelible/error.log',
    out_file: '/var/log/indelible/out.log',
    merge_logs: true,
    time: true,
    max_restarts: 10,
    restart_delay: 1000
  }]
};
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml

name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: indelible_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run lint
      
      - name: Run migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/indelible_test
      
      - run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/indelible_test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: production
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.EC2_HOST }}
          username: indelible
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /var/www/indelible
            git pull origin main
            npm ci --production
            npx prisma migrate deploy
            npm run build
            pm2 restart indelible
```

### Secrets to Configure in GitHub

| Secret | Value |
|--------|-------|
| `EC2_HOST` | EC2 public IP or domain |
| `EC2_SSH_KEY` | Private SSH key for `indelible` user |

### SSH Key Setup

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/indelible-deploy

# Copy public key to EC2
ssh-copy-id -i ~/.ssh/indelible-deploy.pub indelible@your-ec2-ip

# Add private key content to GitHub secret EC2_SSH_KEY
cat ~/.ssh/indelible-deploy
```

---

## Backup Procedures

### RDS Automated Backups

RDS handles this automatically:
- Daily automated backups
- 7-day retention (configurable up to 35 days)
- Point-in-time recovery available

### Manual Backup (Before Major Changes)

```bash
# Create manual RDS snapshot via AWS CLI
aws rds create-db-snapshot \
  --db-instance-identifier indelible-prod \
  --db-snapshot-identifier indelible-pre-deploy-$(date +%Y%m%d)

# Or use pg_dump for local backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```

### Backup Verification

Monthly: Restore a snapshot to a test RDS instance and verify data integrity.

---

## Monitoring & Alerting

### Error Tracking: Sentry (Free Tier)

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

Free tier includes:
- 5,000 errors/month
- 10,000 performance units/month
- Plenty for 20 users

### Uptime Monitoring: UptimeRobot (Free)

- Monitor `https://app.indelible.agency/api/health`
- Check every 5 minutes
- Email alerts on downtime

### Health Check Endpoint

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'unhealthy', error: error.message },
      { status: 503 }
    );
  }
}
```

### AWS CloudWatch (Free Tier Basics)

Automatically monitors:
- EC2 CPU, network, disk
- RDS connections, storage, CPU

Set up alarms for:
- CPU > 80% for 5 minutes
- RDS storage < 20%
- RDS connections > 80% of max

---

## Rollback Procedures

### Code Rollback

```bash
# SSH to EC2

# Option 1: Revert to previous commit
cd /var/www/indelible
git log --oneline -5  # Find commit to revert to
git checkout <commit-hash>
npm ci --production
npm run build
pm2 restart indelible

# Option 2: Revert last migration (if DB issue)
npx prisma migrate resolve --rolled-back <migration-name>
```

### Database Rollback

```bash
# Restore from RDS snapshot (via AWS Console or CLI)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier indelible-prod-restored \
  --db-snapshot-identifier indelible-pre-deploy-20241220

# Update DATABASE_URL to point to restored instance
# Restart application
```

---

## Security Checklist

### Before Go-Live

- [ ] All secrets in environment variables (not in code)
- [ ] `.env` files in `.gitignore`
- [ ] RDS not publicly accessible
- [ ] EC2 security group restricts SSH to known IPs
- [ ] SSL/TLS enforced (HTTPS only)
- [ ] Rate limiting on auth endpoints
- [ ] CORS configured for your domain only
- [ ] SQL injection protected (Prisma handles this)
- [ ] XSS protected (React handles most)
- [ ] CSRF tokens on forms (Next.js handles this)
- [ ] Secure cookie flags set (HttpOnly, Secure, SameSite)
- [ ] Password hashing with bcrypt (cost factor 12+)
- [ ] JWT tokens expire (24h access, 7d refresh)

### Ongoing

- [ ] `npm audit` monthly
- [ ] Ubuntu security updates (`unattended-upgrades`)
- [ ] Review CloudWatch logs periodically
- [ ] Rotate secrets annually

---

## DNS Configuration

### Route 53 (or external DNS)

| Record | Type | Value |
|--------|------|-------|
| app.indelible.agency | A | EC2 Elastic IP |
| staging.indelible.agency | A | EC2 Elastic IP (or separate) |

### Elastic IP

Allocate an Elastic IP and associate with EC2 to ensure IP doesn't change on restart.

```bash
# Via AWS CLI
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id i-xxxx --allocation-id eipalloc-xxxx
```

---

## Cost Summary

### Monthly Costs (Production)

| Service | Cost | Notes |
|---------|------|-------|
| EC2 t3.small | ~$15 | App server |
| RDS db.t3.micro | ~$13 | PostgreSQL with pgvector |
| EBS Storage | ~$2 | 20 GB |
| Elastic IP | $0 | Free when attached to running instance |
| Data Transfer | ~$1 | Minimal for 20 users |
| Route 53 | ~$0.50 | Hosted zone |
| **Total** | **~$31/mo** | |

### Free Services

| Service | Free Tier |
|---------|-----------|
| GitHub Actions | 2,000 mins/month |
| Sentry | 5,000 errors/month |
| UptimeRobot | 50 monitors |
| Resend | 100 emails/day |
| Let's Encrypt | Unlimited certs |

### First Year (Free Tier Eligible)

If using t2.micro EC2 and db.t2.micro RDS:
- Potentially $0 for first 12 months
- Then ~$31/mo after

---

## Runbook: Common Operations

### Deploy New Version

```bash
# Automated (push to main)
git push origin main

# Manual SSH
ssh indelible@app.indelible.agency
cd /var/www/indelible
git pull origin main
npm ci --production
npx prisma migrate deploy
npm run build
pm2 restart indelible
```

### View Logs

```bash
# Application logs
pm2 logs indelible

# Last 100 lines
pm2 logs indelible --lines 100

# Nginx access logs
tail -f /var/log/nginx/access.log

# Nginx error logs
tail -f /var/log/nginx/error.log
```

### Restart Application

```bash
pm2 restart indelible

# Hard restart
pm2 delete indelible
pm2 start ecosystem.config.js
pm2 save
```

### Check Status

```bash
pm2 status
pm2 monit  # Real-time

# Health endpoint
curl https://app.indelible.agency/api/health
```

### Database Access

```bash
# Connect to RDS
psql $DATABASE_URL

# Run Prisma Studio (dev only)
npx prisma studio
```

---

## Related Documents

- `indelible-implementation-plan.md` — Build phases and tech stack
- `indelible-testing-strategy.md` — Testing approach and CI integration
- `indelible-auth-design.md` — Authentication implementation
- `indelible-migration-runbook.md` — Initial data migration from Notion

---