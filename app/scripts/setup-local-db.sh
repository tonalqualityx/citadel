#!/bin/bash

# Citadel Local Database Setup Script
# This script sets up the PostgreSQL database for local development

set -e

echo "🚀 Citadel Local Database Setup"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is available
if ! docker compose version &> /dev/null && ! docker-compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

# Determine docker compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}⚠️  .env.local not found. Creating from .env.local.example...${NC}"
    cp .env.local.example .env.local
    echo -e "${GREEN}✅ Created .env.local${NC}"
fi

# Start PostgreSQL container
echo -e "\n📦 Starting PostgreSQL container..."
$COMPOSE_CMD up -d postgres

# Wait for PostgreSQL to be ready
echo -e "\n⏳ Waiting for PostgreSQL to be ready..."
attempt=0
max_attempts=30
until $COMPOSE_CMD exec -T postgres pg_isready -U citadel -d citadel_dev > /dev/null 2>&1 || [ $attempt -eq $max_attempts ]; do
    sleep 1
    attempt=$((attempt+1))
    echo "   Attempt $attempt/$max_attempts..."
done

if [ $attempt -eq $max_attempts ]; then
    echo -e "${RED}❌ PostgreSQL failed to start within $max_attempts seconds${NC}"
    exit 1
fi

echo -e "${GREEN}✅ PostgreSQL is ready!${NC}"

# Run Prisma migrations
echo -e "\n🔄 Running database migrations..."
npx prisma migrate dev

# Generate Prisma client
echo -e "\n📝 Generating Prisma client..."
npx prisma generate

# Seed the database
echo -e "\n🌱 Seeding database..."
npx prisma db seed

echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo -e "\n📋 Next steps:"
echo "   1. Run 'npm run dev' to start the development server"
echo "   2. Open http://localhost:3000 in your browser"
echo "   3. Default login: admin@citadel.local / admin123"
echo -e "\n🛠️  Useful commands:"
echo "   npm run db:up      - Start the database"
echo "   npm run db:down    - Stop the database"
echo "   npm run db:reset   - Reset database (wipes all data)"
echo "   npm run db:seed    - Re-seed the database"
echo "   npm run db:studio  - Open Prisma Studio"
