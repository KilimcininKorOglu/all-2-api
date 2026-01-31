# Load Balancing and Cluster Deployment Guide

## Architecture Overview

```
Client Request → :13003 (Load Balancer)
                 ↓ IP Hash Routing
         ┌───────┼───────┬───────┬───────┐
         ↓       ↓       ↓       ↓       ↓
      api-1   api-2   api-3   api-4   api-5
      :13004  :13005  :13006  :13007  :13008
                 ↓
            External MySQL
```

## Environment Configuration

Create a `.env` file:

```env
# Load Balancer Port
BALANCER_PORT=13003

# MySQL Database Configuration
MYSQL_HOST=43.228.76.217
MYSQL_PORT=13306
MYSQL_USER=root
MYSQL_PASSWORD=4561230wW?
MYSQL_DATABASE=kiro_api
```

## Startup Methods

### Method 1: Fixed 5 Instances (Recommended for Production)

```bash
# Start
docker-compose -f docker-compose.cluster.yml up -d

# Check Status
docker-compose -f docker-compose.cluster.yml ps

# View Logs
docker-compose -f docker-compose.cluster.yml logs -f

# Stop
docker-compose -f docker-compose.cluster.yml down
```

### Method 2: Dynamic Scaling (Supports Elastic Scaling)

```bash
# Start 5 instances
docker-compose -f docker-compose.scale.yml up -d --scale api=5

# Scale up to 10 (without restarting existing instances)
docker-compose -f docker-compose.scale.yml up -d --scale api=10 --no-recreate

# Scale down to 3
docker-compose -f docker-compose.scale.yml up -d --scale api=3 --no-recreate

# Stop
docker-compose -f docker-compose.scale.yml down
```

### Method 3: Local Development (Without Docker)

```bash
# Terminal 1: Start Load Balancer
npm run balancer

# Terminal 2: Start Cluster (5 instances)
npm run cluster

# Or one-click start
npm run prod
```

## Status Monitoring

### Web Pages

- Load Balancer Status Page: http://localhost:13003/lb
- Public Status Page: http://localhost:13003/status.html (or single node http://localhost:13004/status.html)

### API Endpoints

```bash
# JSON Status
curl http://localhost:13003/lb/status

# Health Check
curl http://localhost:13003/health

# Get Client IP
curl http://localhost:13003/api/client-ip
```

## Load Balancer Features

| Feature              | Description                                                                     |
|----------------------|---------------------------------------------------------------------------------|
| IP Consistent Hash   | Same client IP always routes to the same backend                                |
| Health Check         | Checks backend status every 30 seconds                                          |
| Failover             | Automatically switches when backend is unavailable                              |
| DNS Discovery        | Automatically discovers new instances during dynamic scaling (every 60 seconds) |
| Real-time Monitoring | Web page refreshes status every 5 seconds                                       |

## Configuration Files

| File                         | Description              |
|------------------------------|--------------------------|
| `docker-compose.cluster.yml` | Fixed 5 instances config |
| `docker-compose.scale.yml`   | Dynamic scaling config   |
| `src/balancer.js`            | Load balancer service    |
| `src/cluster.js`             | Cluster startup script   |
| `src/public/status.html`     | Status monitoring page   |
| `.env`                       | Environment variables    |

## Environment Variables

### Load Balancer (balancer.js)

| Variable             | Default | Description                       |
|----------------------|---------|-----------------------------------|
| `BALANCER_PORT`      | 13003   | Load balancer port                |
| `BACKEND_HOSTS`      | -       | Docker mode: Backend address list |
| `BACKEND_DNS`        | -       | DNS discovery mode: Service name  |
| `BACKEND_PORT`       | 13004   | DNS discovery mode: Backend port  |
| `BACKEND_START_PORT` | 13004   | Local mode: Starting port         |
| `BACKEND_COUNT`      | 5       | Local mode: Number of instances   |

### Cluster (cluster.js)

| Variable         | Default | Description         |
|------------------|---------|---------------------|
| `INSTANCE_COUNT` | 5       | Number of instances |
| `START_PORT`     | 13004   | Starting port       |

### Database

| Variable         | Default              | Description       |
|------------------|----------------------|-------------------|
| `MYSQL_HOST`     | host.docker.internal | Database address  |
| `MYSQL_PORT`     | 13306                | Database port     |
| `MYSQL_USER`     | root                 | Database user     |
| `MYSQL_PASSWORD` | -                    | Database password |
| `MYSQL_DATABASE` | kiro_api             | Database name     |
