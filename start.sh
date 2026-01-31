#!/bin/bash

# Kiro API Server startup script
# Usage: ./start.sh

echo "=========================================="
echo "  Kiro API Server Startup Script"
echo "=========================================="
echo ""

# Change to the script's directory
cd "$(dirname "$0")/code"

echo "Starting server..."
echo ""

# Start the server
node src/server.js
