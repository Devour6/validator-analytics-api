#!/bin/bash
set -euo pipefail

# Validator Analytics API - Mainnet Deployment Script
# This script deploys the validator analytics API to mainnet with full production configuration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="docker-compose.mainnet.yml"
ENV_FILE=".env.mainnet"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Function to check if required commands exist
check_dependencies() {
    log "Checking dependencies..."
    
    local deps=("docker" "docker-compose" "curl" "jq")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            error "Required dependency '$dep' is not installed"
            exit 1
        fi
    done
    
    # Check Docker is running
    if ! docker info &> /dev/null; then
        error "Docker is not running. Please start Docker daemon."
        exit 1
    fi
    
    success "All dependencies satisfied"
}

# Function to validate environment file
validate_environment() {
    log "Validating environment configuration..."
    
    if [[ ! -f "$PROJECT_DIR/$ENV_FILE" ]]; then
        error "Environment file $ENV_FILE not found"
        error "Please copy .env.example to $ENV_FILE and configure it"
        exit 1
    fi
    
    # Check for required environment variables
    local required_vars=(
        "NODE_ENV"
        "SOLANA_RPC_URL"
        "API_KEY_SECRET"
        "REDIS_PASSWORD"
    )
    
    source "$PROJECT_DIR/$ENV_FILE"
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            error "Required environment variable '$var' is not set in $ENV_FILE"
            exit 1
        fi
    done
    
    if [[ "$NODE_ENV" != "production" ]]; then
        warning "NODE_ENV is not set to 'production'. Current value: $NODE_ENV"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    success "Environment configuration validated"
}

# Function to check SSL certificates
check_ssl_certificates() {
    log "Checking SSL certificates..."
    
    local ssl_dir="$PROJECT_DIR/nginx/ssl"
    local cert_file="$ssl_dir/validator-analytics.pem"
    local key_file="$ssl_dir/validator-analytics.key"
    
    if [[ ! -f "$cert_file" ]] || [[ ! -f "$key_file" ]]; then
        warning "SSL certificates not found in $ssl_dir"
        warning "The deployment will work with HTTP, but HTTPS is recommended for production"
        warning "To set up SSL certificates:"
        warning "  1. Obtain certificates from your CA or use Let's Encrypt"
        warning "  2. Place the certificate in: $cert_file"
        warning "  3. Place the private key in: $key_file"
        
        read -p "Continue without SSL? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        # Validate certificates
        if ! openssl x509 -in "$cert_file" -noout -checkend 86400; then
            error "SSL certificate expires within 24 hours!"
            exit 1
        fi
        success "SSL certificates found and valid"
    fi
}

# Function to run pre-deployment tests
run_tests() {
    log "Running pre-deployment tests..."
    
    # Build test image
    docker build -f Dockerfile.production --target test -t validator-analytics-api:test . || {
        error "Failed to build test image"
        exit 1
    }
    
    # Run tests
    docker run --rm \
        -e RUN_INTEGRATION_TESTS=false \
        -v "$PROJECT_DIR/test-results:/app/test-results" \
        validator-analytics-api:test || {
        error "Tests failed"
        exit 1
    }
    
    success "Tests passed"
}

# Function to backup existing deployment
backup_existing() {
    if docker-compose -f "$COMPOSE_FILE" ps -q | grep -q .; then
        log "Creating backup of existing deployment..."
        
        local backup_dir="backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$backup_dir"
        
        # Export volumes
        docker-compose -f "$COMPOSE_FILE" exec redis redis-cli BGSAVE || warning "Failed to backup Redis"
        
        # Copy configuration files
        cp -r nginx monitoring "$backup_dir/" || warning "Failed to backup configuration"
        
        success "Backup created in $backup_dir"
    fi
}

# Function to deploy the stack
deploy() {
    log "Starting deployment..."
    
    cd "$PROJECT_DIR"
    
    # Pull latest images
    log "Pulling latest images..."
    docker-compose -f "$COMPOSE_FILE" pull
    
    # Build our custom images
    log "Building application images..."
    docker-compose -f "$COMPOSE_FILE" build --pull
    
    # Start the stack
    log "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    success "Services started"
}

# Function to wait for services to be healthy
wait_for_services() {
    log "Waiting for services to become healthy..."
    
    local max_wait=300  # 5 minutes
    local wait_time=0
    local check_interval=10
    
    while [[ $wait_time -lt $max_wait ]]; do
        local healthy_services=0
        local total_services=0
        
        # Check each service
        for service in validator-analytics-api redis prometheus grafana nginx; do
            total_services=$((total_services + 1))
            
            if docker-compose -f "$COMPOSE_FILE" ps -q "$service" | xargs docker inspect --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
                healthy_services=$((healthy_services + 1))
            fi
        done
        
        if [[ $healthy_services -eq $total_services ]]; then
            success "All services are healthy"
            return 0
        fi
        
        log "Services healthy: $healthy_services/$total_services. Waiting..."
        sleep $check_interval
        wait_time=$((wait_time + check_interval))
    done
    
    error "Services did not become healthy within ${max_wait} seconds"
    docker-compose -f "$COMPOSE_FILE" ps
    return 1
}

# Function to run post-deployment verification
verify_deployment() {
    log "Running post-deployment verification..."
    
    # Test API health endpoint
    local api_url="http://localhost:3001/health"
    if curl -f "$api_url" &>/dev/null; then
        success "API health check passed"
    else
        error "API health check failed"
        return 1
    fi
    
    # Test metrics endpoint
    local metrics_url="http://localhost:3001/metrics"
    if curl -f "$metrics_url" &>/dev/null; then
        success "Metrics endpoint accessible"
    else
        warning "Metrics endpoint not accessible (may be restricted)"
    fi
    
    # Test main API endpoint
    local main_api_url="http://localhost:3001/api/v1/validators"
    if curl -f "$main_api_url" &>/dev/null; then
        success "Main API endpoint responding"
    else
        warning "Main API endpoint may not be ready yet"
    fi
    
    # Test Redis connection
    if docker-compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping | grep -q PONG; then
        success "Redis connection test passed"
    else
        error "Redis connection test failed"
        return 1
    fi
    
    success "Deployment verification completed"
}

# Function to display deployment summary
show_summary() {
    log "Deployment Summary:"
    echo ""
    echo "🚀 Validator Analytics API is now running in mainnet mode!"
    echo ""
    echo "Service endpoints:"
    echo "  • API Health: http://localhost:3001/health"
    echo "  • API Metrics: http://localhost:3001/metrics"
    echo "  • Main API: http://localhost:3001/api/v1/"
    echo "  • Grafana: http://localhost:3000"
    echo "  • Prometheus: http://localhost:9091"
    echo ""
    echo "To check service status:"
    echo "  docker-compose -f $COMPOSE_FILE ps"
    echo ""
    echo "To view logs:"
    echo "  docker-compose -f $COMPOSE_FILE logs -f [service-name]"
    echo ""
    echo "To stop services:"
    echo "  docker-compose -f $COMPOSE_FILE down"
    echo ""
    success "Deployment completed successfully!"
}

# Function to handle cleanup on script exit
cleanup() {
    if [[ $? -ne 0 ]]; then
        error "Deployment failed. Check logs for details:"
        docker-compose -f "$COMPOSE_FILE" logs --tail=50
    fi
}

# Main execution
main() {
    trap cleanup EXIT
    
    log "Starting Validator Analytics API mainnet deployment"
    
    check_dependencies
    validate_environment
    check_ssl_certificates
    
    if [[ "${SKIP_TESTS:-false}" != "true" ]]; then
        run_tests
    else
        warning "Skipping tests (SKIP_TESTS=true)"
    fi
    
    backup_existing
    deploy
    wait_for_services
    verify_deployment
    show_summary
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-tests)
            export SKIP_TESTS=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--skip-tests] [--help]"
            echo ""
            echo "Options:"
            echo "  --skip-tests  Skip running tests before deployment"
            echo "  --help        Show this help message"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main "$@"