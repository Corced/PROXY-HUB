#!/bin/sh
# Query Caddy access logs for AI usage by Discord user
# Usage: sh scripts/audit-log-query.sh DISCORD_USER_ID

DISCORD_USER_ID=$1

if [ -z "$DISCORD_USER_ID" ]; then
    echo "Usage: $0 DISCORD_USER_ID"
    echo "Example: $0 123456789012345678"
    exit 1
fi

LOG_FILE="/var/log/caddy/access.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    exit 1
fi

echo "Searching for Discord User ID: $DISCORD_USER_ID"
echo "Log file: $LOG_FILE"
echo ""

# Use jq to filter JSON log entries by X-Discord-User-ID header
cat "$LOG_FILE" | \
    jq --arg uid "$DISCORD_USER_ID" \
    'select(.request.headers["X-Discord-User-ID"] != null and .request.headers["X-Discord-User-ID"][0] == $uid)'