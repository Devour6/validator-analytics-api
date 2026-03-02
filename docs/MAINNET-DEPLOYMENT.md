# Mainnet Deployment Guide - Validator Analytics API

This guide covers the complete production deployment of the Validator Analytics API on mainnet with monitoring, security, and high availability configurations.

## Overview

The mainnet deployment includes:
- Production-optimized Docker containers
- Redis caching layer
- Prometheus metrics collection
- Grafana monitoring dashboards
- Nginx reverse proxy with SSL termination
- Comprehensive health checks and alerting
- Automated deployment scripts

## Prerequisites

### System Requirements
- **OS**: Linux (Ubuntu 20.04+ or CentOS 8+ recommended)
- **CPU**: Minimum 4 cores (8 cores recommended)
- **RAM**: Minimum 8GB (16GB recommended)
- **Storage**: Minimum 50GB SSD (100GB recommended)
- **Network**: Stable internet connection with low latency to Solana RPC endpoints

### Software Dependencies
- Docker 20.10+
- Docker Compose 2.0+
- Git
- curl
- jq (for JSON processing)
- openssl (for SSL certificate validation)

### Access Requirements
- GitHub access to Devour6/validator-analytics-api repository
- SSH key configured for GitHub
- Sudo access on deployment server
- Domain name configured (e.g., validator-analytics-api.phase.com)

## Pre-Deployment Setup

### 1. Server Preparation

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y docker.io docker-compose-v2 git curl jq openssl

# Add your user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
```

### 2. Firewall Configuration

```bash
# Allow SSH (adjust port as needed)
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow monitoring ports (restrict to monitoring networks in production)
sudo ufw allow from 10.0.0.0/8 to any port 3000  # Grafana
sudo ufw allow from 10.0.0.0/8 to any port 9091  # Prometheus

# Enable firewall
sudo ufw --force enable
```

### 3. SSL Certificate Setup

For production deployment with HTTPS, you'll need SSL certificates:

#### Option A: Let's Encrypt (Recommended)
```bash
# Install certbot
sudo apt install -y certbot

# Obtain certificates (replace with your domain)
sudo certbot certonly --standalone -d validator-analytics-api.phase.com

# Copy certificates to project
sudo cp /etc/letsencrypt/live/validator-analytics-api.phase.com/fullchain.pem nginx/ssl/validator-analytics.pem
sudo cp /etc/letsencrypt/live/validator-analytics-api.phase.com/privkey.pem nginx/ssl/validator-analytics.key
sudo chown $USER:$USER nginx/ssl/*
```

#### Option B: Custom CA Certificates
```bash
# Place your certificates in the nginx/ssl directory
cp your-certificate.pem nginx/ssl/validator-analytics.pem
cp your-private-key.key nginx/ssl/validator-analytics.key

# Set appropriate permissions
chmod 644 nginx/ssl/validator-analytics.pem
chmod 600 nginx/ssl/validator-analytics.key
```

## Environment Configuration

### 1. Create Environment File

```bash
# Copy the mainnet environment template
cp .env.mainnet.example .env.mainnet

# Edit with your specific values
nano .env.mainnet
```

### 2. Required Environment Variables

Update these variables in `.env.mainnet`:

```bash
# Security
API_KEY_SECRET=your-secure-api-key-32-chars-minimum
REDIS_PASSWORD=your-secure-redis-password
GRAFANA_ADMIN_PASSWORD=your-secure-grafana-password

# Solana Configuration
HELIUS_API_KEY=your-helius-api-key-for-backup-rpc

# External APIs (if applicable)
STAKING_API_KEY=your-staking-api-integration-key

# Alerting (optional)
ALERT_WEBHOOK_URL=https://your-alerting-system.com/webhook
```

### 3. Security Hardening

```bash
# Generate secure random passwords
API_KEY_SECRET=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)

# Add these to your .env.mainnet file
echo "API_KEY_SECRET=$API_KEY_SECRET" >> .env.mainnet
echo "REDIS_PASSWORD=$REDIS_PASSWORD" >> .env.mainnet
echo "GRAFANA_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD" >> .env.mainnet
```

## Deployment Process

### 1. Clone and Setup Repository

```bash
# Clone the repository
git clone https://github.com/Devour6/validator-analytics-api.git
cd validator-analytics-api

# Checkout mainnet deployment branch
git checkout feature/mainnet-deployment

# Verify all files are present
ls -la monitoring/ nginx/ scripts/
```

### 2. Pre-Deployment Validation

```bash
# Run the deployment script with dry-run
./scripts/deploy-mainnet.sh --help

# Check configuration
docker-compose -f docker-compose.mainnet.yml config

# Validate environment
source .env.mainnet && echo "Environment loaded: $NODE_ENV"
```

### 3. Execute Deployment

```bash
# Full deployment with tests
./scripts/deploy-mainnet.sh

# Skip tests (faster deployment)
./scripts/deploy-mainnet.sh --skip-tests
```

### 4. Post-Deployment Verification

```bash
# Check service status
docker-compose -f docker-compose.mainnet.yml ps

# Test API endpoints
curl -f http://localhost:3001/health
curl -f http://localhost:3001/api/v1/validators

# Check logs
docker-compose -f docker-compose.mainnet.yml logs -f validator-analytics-api
```

## Monitoring and Alerting

### 1. Access Monitoring Dashboards

- **Grafana**: https://validator-analytics-api.phase.com/grafana/
  - Username: admin
  - Password: (from GRAFANA_ADMIN_PASSWORD)

- **Prometheus**: https://validator-analytics-api.phase.com/prometheus/
  - Internal access only

### 2. Key Metrics to Monitor

- **API Performance**:
  - Response time (95th percentile)
  - Request rate
  - Error rate
  - Active connections

- **System Resources**:
  - CPU usage
  - Memory usage
  - Disk space
  - Network I/O

- **Redis Performance**:
  - Memory usage
  - Hit rate
  - Connected clients
  - Command statistics

- **Solana Integration**:
  - RPC response times
  - RPC error rates
  - Data freshness

### 3. Alert Configuration

Key alerts are pre-configured:
- API downtime (critical)
- High error rates (warning)
- Resource exhaustion (critical)
- Certificate expiration (warning)

## Maintenance

### 1. Regular Updates

```bash
# Pull latest changes
git pull origin feature/mainnet-deployment

# Rebuild and redeploy
docker-compose -f docker-compose.mainnet.yml build --pull
docker-compose -f docker-compose.mainnet.yml up -d
```

### 2. Backup Procedures

```bash
# Backup Redis data
docker-compose -f docker-compose.mainnet.yml exec redis redis-cli BGSAVE

# Backup configuration
tar -czf backup-$(date +%Y%m%d).tar.gz nginx/ monitoring/ .env.mainnet

# Backup volumes
docker run --rm -v validator-analytics-redis-mainnet:/data -v $(pwd):/backup alpine tar czf /backup/redis-backup-$(date +%Y%m%d).tar.gz /data
```

### 3. Log Management

```bash
# View logs
docker-compose -f docker-compose.mainnet.yml logs -f [service]

# Rotate logs (automated via Docker)
docker system prune -f

# Archive old logs
find /var/lib/docker/containers -name "*.log" -type f -mtime +7 -delete
```

### 4. SSL Certificate Renewal

```bash
# Renew Let's Encrypt certificates
sudo certbot renew --dry-run

# Auto-renewal (add to crontab)
echo "0 12 * * * /usr/bin/certbot renew --quiet" | sudo crontab -
```

## Scaling

### 1. Horizontal Scaling

```bash
# Scale API instances
docker-compose -f docker-compose.mainnet.yml up -d --scale validator-analytics-api=3
```

### 2. Load Balancer Configuration

For multiple instances, configure your external load balancer to:
- Distribute traffic across API instances
- Health check on `/health` endpoint
- Session affinity (if needed)

## Troubleshooting

### 1. Common Issues

**API Won't Start**:
```bash
# Check environment variables
docker-compose -f docker-compose.mainnet.yml config
source .env.mainnet && env | grep -E "(NODE_ENV|PORT|REDIS_URL)"

# Check dependencies
docker-compose -f docker-compose.mainnet.yml exec redis redis-cli ping
```

**High Memory Usage**:
```bash
# Check Redis memory
docker-compose -f docker-compose.mainnet.yml exec redis redis-cli info memory

# Restart services if needed
docker-compose -f docker-compose.mainnet.yml restart validator-analytics-api
```

**SSL Issues**:
```bash
# Verify certificates
openssl x509 -in nginx/ssl/validator-analytics.pem -text -noout
openssl rsa -in nginx/ssl/validator-analytics.key -check
```

### 2. Emergency Procedures

**Complete Rollback**:
```bash
# Stop current deployment
docker-compose -f docker-compose.mainnet.yml down

# Restore from backup
tar -xzf backup-YYYYMMDD.tar.gz
docker-compose -f docker-compose.mainnet.yml up -d
```

**Service Recovery**:
```bash
# Restart individual services
docker-compose -f docker-compose.mainnet.yml restart [service-name]

# Force recreation
docker-compose -f docker-compose.mainnet.yml up -d --force-recreate [service-name]
```

## Security Considerations

1. **Network Security**: Use VPC/security groups to restrict access
2. **Secrets Management**: Store sensitive values in secure secret managers
3. **Regular Updates**: Keep Docker images and host system updated
4. **Monitoring**: Set up intrusion detection and log monitoring
5. **Backup Security**: Encrypt backups and store securely

## Support

For deployment issues:
1. Check logs: `docker-compose -f docker-compose.mainnet.yml logs`
2. Verify configuration: Review environment variables and configs
3. Contact: Create issue in GitHub repository with deployment logs

---

**Last Updated**: March 2026  
**Version**: 1.0.0  
**Maintainer**: Ross - Phase Labs