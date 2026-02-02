#!/bin/bash

# Set your variables
MONGO_HOST="localhost"
MONGO_PORT="27017"  # default port
MONGO_USER="modelvi"
MONGO_PASS="P33j753e!"
AUTH_DB="admin" 
BACKUP_DB="chatbots"
BACKUP_FILE="/var/backups/mongo/modelvi_backup_2026-01-23_14-16.archive.gz"

# Restore command
mongorestore --host "$MONGO_HOST" --port "$MONGO_PORT" \
--username "$MONGO_USER" --password "$MONGO_PASS" \
--authenticationDatabase "$AUTH_DB" \
--archive="$BACKUP_FILE" \
--gzip \
--verbose