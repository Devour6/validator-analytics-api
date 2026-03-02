#!/bin/bash
# Enhanced Deployment Script for Validator Analytics API
# Supports container-based deployment, rollback, and health checks

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Configuration
COMPOSE_FILE="docker-compose.mainnet.yml"
SERVICE_NAME="validator-analytics-api"
HEALTH_ENDPOINT="http://localhost:3001/health"
MAX_HEALTH_RETRIES=30
HEALTH_RETRY_INTERVAL=10
BACKUP_TAG="backup-$(date +%Y%m%d-%H%M%S)"
REGISTRY_URL="${DOCKER_REGISTRY_URL:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
Enhanced Validator Analytics API Deployment Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
  deploy          Deploy the application (default)
  rollback        Rollback to previous version
  status          Show deployment status
  logs            Show service logs
  health          Run health check
  backup          Backup current deployment
  cleanup         Remove old images and containers

Options:
  --env FILE      Environment file to use (default: .env.mainnet)
  --no-backup     Skip creating backup before deployment
  --force         Force deployment without confirmation
  --registry URL  Docker registry URL for pushing images
  --help, -h      Show this help message

Examples:
  $0 deploy --env .env.staging
  $0 rollback
  $0 status
  $0 health
  $0 logs --follow

EOF
}

# Parse command line arguments
COMMAND="deploy"
ENV_FILE=".env.mainnet"
CREATE_BACKUP=true
FORCE_DEPLOY=false
FOLLOW_LOGS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        deploy|rollback|status|logs|health|backup|cleanup)
            COMMAND=$1
            shift
            ;;
        --env)
            ENV_FILE="$2"
            shift 2
            ;;
        --no-backup)
            CREATE_BACKUP=false
            shift
            ;;
        --force)
            FORCE_DEPLOY=true
            shift
            ;;
        --registry)
            REGISTRY_URL="$2"
            shift 2
            ;;
        --follow)
            FOLLOW_LOGS=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate requirements
validate_requirements() {
    log_info "Validating deployment requirements..."
    
    # Check if Docker and Docker Compose are available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed or not in PATH"
        exit 1
    fi
    
    # Check if compose file exists
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "Docker Compose file not found: $COMPOSE_FILE"
        exit 1
    fi
    
    # Check if environment file exists
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        log_warning "Copy .env.mainnet.template to $ENV_FILE and configure it"
        exit 1
    fi
    
    # Validate environment variables
    source "$ENV_FILE"
    local missing_vars=()
    
    if [[ -z "${GRAFANA_ADMIN_PASSWORD:-}" ]]; then
        missing_vars+=("GRAFANA_ADMIN_PASSWORD")
    fi
    
    if [[ -z "${API_KEY_SECRET:-}" ]]; then
        missing_vars+=("API_KEY_SECRET")
    fi
    
    if [[ -z "${REDIS_PASSWORD:-}" ]]; then
        missing_vars+=("REDIS_PASSWORD")
    fi
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required environment variables:"
        printf '%s\n' "${missing_vars[@]}"
        exit 1
    fi
    
    log_success "Requirements validation passed"
}

# Health check function
perform_health_check() {
    local retries=0
    local endpoint="${1:-$HEALTH_ENDPOINT}"
    
    log_info "Performing health check on $endpoint..."
    
    while [[ $retries -lt $MAX_HEALTH_RETRIES ]]; do
        if curl -sf "$endpoint" &> /dev/null; then
            log_success "Health check passed"
            return 0
        fi
        
        retries=$((retries + 1))
        if [[ $retries -lt $MAX_HEALTH_RETRIES ]]; then
            log_warning "Health check failed (attempt $retries/$MAX_HEALTH_RETRIES), retrying in ${HEALTH_RETRY_INTERVAL}s..."
            sleep $HEALTH_RETRY_INTERVAL
        fi
    done
    
    log_error "Health check failed after $MAX_HEALTH_RETRIES attempts"
    return 1
}

# Backup current deployment
create_backup() {
    if [[ "$CREATE_BACKUP" == "false" ]]; then
        log_info "Skipping backup as requested"
        return 0
    fi
    
    log_info "Creating backup of current deployment..."
    
    # Tag current image as backup
    if docker images | grep -q "$SERVICE_NAME"; then
        local current_image=$(docker ps --format "table {{.Image}}" | grep "$SERVICE_NAME" | head -1)
        if [[ -n "$current_image" ]]; then
            docker tag "$current_image" "${SERVICE_NAME}:${BACKUP_TAG}"
            log_success "Backup created: ${SERVICE_NAME}:${BACKUP_TAG}"
        fi
    fi
    
    # Backup volumes
    if docker volume ls | grep -q "validator-analytics"; then
        log_info "Backing up volumes..."
        docker run --rm -v validator-analytics-data:/data -v $(pwd)/backups:/backup alpine tar czf "/backup/volumes-${BACKUP_TAG}.tar.gz" -C /data .
        log_success "Volume backup created: backups/volumes-${BACKUP_TAG}.tar.gz"
    fi
}

# Deploy function
deploy() {
    log_info "🚀 Starting deployment of Validator Analytics API..."
    
    # Validate everything first
    validate_requirements
    
    # Create backup if requested
    create_backup
    
    # Confirm deployment in production
    if [[ "$FORCE_DEPLOY" == "false" && "$ENV_FILE" == ".env.mainnet" ]]; then
        log_warning "You are about to deploy to MAINNET production environment!"
        read -p "Are you sure you want to continue? (y/N): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Deployment cancelled"
            exit 0
        fi
    fi
    
    # Build images
    log_info "📦 Building application images..."
    if ! docker-compose -f "$COMPOSE_FILE" build --no-cache; then
        log_error "Build failed"
        exit 1
    fi
    log_success "Build completed successfully"
    
    # Push to registry if configured
    if [[ -n "$REGISTRY_URL" ]]; then
        log_info "🌐 Pushing images to registry..."
        docker-compose -f "$COMPOSE_FILE" push
        log_success "Images pushed to registry"
    fi
    
    # Stop existing containers gracefully
    log_info "⏹️ Stopping existing containers..."
    docker-compose -f "$COMPOSE_FILE" down --timeout 30
    
    # Start new deployment
    log_info "🎯 Starting new deployment..."
    if ! docker-compose -f "$COMPOSE_FILE" up -d; then
        log_error "Deployment failed"
        log_info "Rolling back..."
        rollback_deployment
        exit 1
    fi
    
    # Wait for containers to be ready
    log_info "⏳ Waiting for services to start..."
    sleep 15
    
    # Perform health checks
    if perform_health_check; then
        log_success "🚀 Deployment completed successfully!"
        show_deployment_status
    else
        log_error "Health check failed, rolling back deployment..."
        rollback_deployment
        exit 1
    fi
}

# Rollback function
rollback_deployment() {
    log_warning "🔄 Starting rollback to previous version..."
    
    # Find most recent backup
    local backup_image=$(docker images --format "table {{.Repository}}:{{.Tag}}" | grep "$SERVICE_NAME:backup-" | sort -r | head -1)
    
    if [[ -z "$backup_image" ]]; then
        log_error "No backup image found for rollback"
        exit 1
    fi
    
    log_info "Rolling back to: $backup_image"
    
    # Stop current deployment
    docker-compose -f "$COMPOSE_FILE" down --timeout 30
    
    # Restore backup image
    docker tag "$backup_image" "${SERVICE_NAME}:latest"
    
    # Start with backup
    docker-compose -f "$COMPOSE_FILE" up -d
    
    # Health check
    if perform_health_check; then
        log_success "Rollback completed successfully"
    else
        log_error "Rollback failed - manual intervention required"
        exit 1
    fi
}

# Status function
show_deployment_status() {
    log_info "📊 Deployment Status:"
    echo
    docker-compose -f "$COMPOSE_FILE" ps
    echo
    
    # Show resource usage
    log_info "💾 Resource Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
    echo
    
    # Show service URLs
    log_info "🔗 Service Endpoints:"
    echo "  Health Check: $HEALTH_ENDPOINT"
    echo "  API Docs: http://localhost:3001/docs"
    echo "  Prometheus: http://localhost:9091"
    echo "  Grafana: http://localhost:3000"
    echo
}

# Logs function
show_logs() {
    if [[ "$FOLLOW_LOGS" == "true" ]]; then
        docker-compose -f "$COMPOSE_FILE" logs -f
    else
        docker-compose -f "$COMPOSE_FILE" logs --tail=100
    fi
}

# Cleanup function
cleanup() {
    log_info "🧹 Cleaning up old images and containers..."
    
    # Remove dangling images
    docker image prune -f
    
    # Remove old backup images (keep only 5 most recent)
    local old_backups=$(docker images --format "table {{.Repository}}:{{.Tag}}" | grep "$SERVICE_NAME:backup-" | sort -r | tail -n +6)
    if [[ -n "$old_backups" ]]; then
        echo "$old_backups" | xargs -r docker rmi
        log_success "Removed old backup images"
    fi
    
    # Remove unused volumes
    docker volume prune -f
    
    log_success "Cleanup completed"
}

# Main execution
case $COMMAND in
    deploy)
        deploy
        ;;
    rollback)
        rollback_deployment
        ;;
    status)
        show_deployment_status
        ;;
    logs)
        show_logs
        ;;
    health)
        perform_health_check && log_success "Service is healthy" || log_error "Service is unhealthy"
        ;;
    backup)
        CREATE_BACKUP=true
        create_backup
        ;;
    cleanup)
        cleanup
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac