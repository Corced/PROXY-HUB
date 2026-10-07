#!/bin/sh
# Refuses to start if dangerous defaults are detected
if [ "$INITIAL_ADMIN_PASSWORD" = "admin" ] || \
   [ "$INITIAL_ADMIN_PASSWORD" = "admin123" ] || \
   [ "$INITIAL_ADMIN_PASSWORD" = "123456" ] || \
   [ -z "$INITIAL_ADMIN_PASSWORD" ]; then
  echo "❌ FATAL: INITIAL_ADMIN_PASSWORD is not set or is a default value."
  echo "   Set a strong password in your .env file before starting."
  exit 1
fi
if [ ${#SESSION_SECRET} -lt 32 ]; then
  echo "❌ FATAL: SESSION_SECRET is too short. Minimum 32 characters."
  exit 1
fi
if [ ${#NEW_API_JWT_SECRET} -lt 32 ]; then
  echo "❌ FATAL: NEW_API_JWT_SECRET is too short. Minimum 32 characters."
  exit 1
fi
echo "✅ Security defaults check passed."