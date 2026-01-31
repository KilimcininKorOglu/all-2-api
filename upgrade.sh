#!/bin/bash

# Rolling upgrade script - Zero downtime update
# Usage: ./upgrade.sh

set -e

COMPOSE_FILE="docker-compose.scale.yml"
SLEEP_INTERVAL=3

echo "========================================="
echo "  Kiro API Rolling Upgrade Script"
echo "========================================="
echo ""

# Get the directory where the script is located
cd "$(dirname "$0")"

echo "[1/4] Pulling latest code..."
git pull origin main
echo ""

echo "[2/4] Building new image..."
docker compose -f $COMPOSE_FILE build
echo ""

echo "[3/4] Rolling restart of API services..."
for i in 1 2 3 4 5; do
    echo "  - Restarting api-$i ..."
    docker compose -f $COMPOSE_FILE up -d --no-deps api-$i
    sleep $SLEEP_INTERVAL
done
echo ""

echo "[4/4] Restarting load balancer..."
docker compose -f $COMPOSE_FILE up -d --no-deps balancer
echo ""

echo "========================================="
echo "  Upgrade Complete!"
echo "========================================="
echo ""

echo "Service status:"
docker compose -f $COMPOSE_FILE ps
echo ""

echo "Testing API:"
curl -s http://localhost:13003/api/bedrock/models | head -c 100
echo "..."
