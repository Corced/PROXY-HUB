#!/bin/sh
# Run once: sh scripts/generate-secrets.sh >> .env
echo "SESSION_SECRET=$(openssl rand -hex 64)"
echo "NEW_API_JWT_SECRET=$(openssl rand -hex 64)"
echo "INITIAL_ADMIN_PASSWORD=$(openssl rand -base64 32)"
echo "DB_PASSWORD=$(openssl rand -base64 24)"
echo "REDIS_PASSWORD=$(openssl rand -base64 24)"
echo "ROUTER_PASSWORD=$(openssl rand -base64 24)"