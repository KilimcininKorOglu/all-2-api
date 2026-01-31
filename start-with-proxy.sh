#!/bin/bash

# Kiro API Server startup script (with proxy)
# Usage: ./start-with-proxy.sh [proxy_url]
# Example: ./start-with-proxy.sh http://127.0.0.1:7890

# Default proxy address
DEFAULT_PROXY="http://127.0.0.1:7890"

# Use the provided proxy address or default value
PROXY_URL="${1:-$DEFAULT_PROXY}"

echo "=========================================="
echo "  Kiro API Server Startup Script"
echo "=========================================="
echo ""
echo "Proxy address: $PROXY_URL"
echo ""

# Set proxy environment variables
export HTTP_PROXY="$PROXY_URL"
export HTTPS_PROXY="$PROXY_URL"
export http_proxy="$PROXY_URL"
export https_proxy="$PROXY_URL"

# Optional: Set addresses that bypass the proxy
export NO_PROXY="localhost,127.0.0.1,::1"
export no_proxy="localhost,127.0.0.1,::1"

echo "Environment variables set:"
echo "  HTTP_PROXY=$HTTP_PROXY"
echo "  HTTPS_PROXY=$HTTPS_PROXY"
echo "  NO_PROXY=$NO_PROXY"
echo ""

# Change to the script's directory
cd "$(dirname "$0")"

echo "Starting server..."
echo ""

# Start the server
node src/server.js
