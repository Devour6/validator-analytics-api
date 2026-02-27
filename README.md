# Solana Validator Analytics API

**On-chain validator data API for Phase Labs - No third-party dependencies**

A production-ready REST API that provides comprehensive Solana validator analytics using **only on-chain data sources**. Built for Phase Labs' $10M revenue product, this API fetches all data directly from Solana RPC endpoints without relying on external services like SVT, Stakewiz, or other third-party APIs.

## 🎯 Features

- **100% On-chain Data**: Uses only `getVoteAccounts` RPC calls and validator-info program
- **Production Ready**: Built with TypeScript, Express, comprehensive error handling
- **High Performance**: Batched RPC calls, efficient data processing, Redis caching layer
- **RESTful API**: Clean, documented endpoints with query parameters
- **Health Monitoring**: Built-in health checks and RPC status monitoring
- **Zero External Dependencies**: No third-party validator APIs

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Build the project
npm run build

# Start development server
npm run dev

# Or start production server
npm run start
```

### With Docker (Recommended)

```bash
# Start with Redis cache
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## 📡 API Endpoints

### `GET /api/validators`

Returns comprehensive validator data from on-chain sources.

**Query Parameters:**
- `limit` (number): Number of validators to return (default: all)
- `sortBy` (string): Sort field - `stake`, `commission`, `name` (default: `stake`)
- `order` (string): Sort order - `asc`, `desc` (default: `desc`)
- `activeOnly` (boolean): Only return active validators (default: `false`)

**Example Request:**
```bash
curl "http://localhost:3001/api/validators?limit=10&sortBy=stake&order=desc&activeOnly=true"
```

**Response Format:**
```json
{
  "validators": [
    {
      "identity": "vote_account_pubkey",
      "name": "Validator Name",
      "stake": 1500000000000,
      "commission": 5,
      "activatedStake": 1500000000000,
      "epochVoteAccount": true,
      "nodePubkey": "node_pubkey",
      "rootSlot": 123456789,
      "lastVote": 123456790,
      "epochCredits": [[epoch, credits, prevCredits], ...]
    }
  ],
  "epoch": 456,
  "totalValidators": 1500,
  "totalStake": 400000000000000,
  "timestamp": 1677123456789,
  "requestParams": {
    "limit": 10,
    "sortBy": "stake",
    "order": "desc",
    "activeOnly": true
  },
  "meta": {
    "responseTimeMs": 850,
    "returnedCount": 10
  }
}
```

### `GET /health`

Health check endpoint with RPC status.

**Response:**
```json
{
  "status": "ok",
  "service": "validator-analytics-api",
  "version": "1.0.0",
  "timestamp": 1677123456789,
  "solana": {
    "status": "healthy",
    "blockHeight": 123456789,
    "epoch": 456
  }
}
```

### `GET /`

API documentation and available endpoints.

## 🏗️ Architecture

### Data Sources

1. **`getVoteAccounts` RPC Call**: Primary data source for validator metrics
   - Validator vote account pubkeys
   - Delegated stake amounts
   - Commission percentages
   - Vote account status (active/delinquent)
   - Epoch credits and voting history

2. **Validator Info Program**: Secondary data source for validator metadata
   - Program ID: `Va1idkzkB6LEmVFmxWbWU5Ao17SMcTLofw1bh6qr5RP`
   - Validator names and descriptions
   - Website and contact information
   - Parsed from on-chain account data

### Performance Optimizations

- **Batched RPC Calls**: Validator info fetched in batches of 100 to respect rate limits
- **Concurrent Processing**: Uses Promise.allSettled for parallel data fetching  
- **Error Resilience**: Graceful fallback when validator info is unavailable
- **Response Caching**: Ready for Redis integration for production caching

### Error Handling

- Comprehensive try/catch blocks around all RPC calls
- Graceful degradation when validator-info program data is unavailable
- Detailed error logging for debugging
- Client-friendly error messages

## 🔧 Configuration

Environment variables (see `.env.example`):

```env
PORT=3001
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
NODE_ENV=production
```

**Supported RPC Endpoints:**
- `https://api.mainnet-beta.solana.com` (Default)
- `https://solana-api.projectserum.com`
- Any compatible Solana RPC endpoint

## 💾 Redis Caching Layer

The API includes a comprehensive Redis caching layer to reduce RPC costs and improve response times.

### Cache TTL Configuration

| Endpoint | Cache Key | TTL |
|----------|-----------|-----|
| `/api/validators` | `validators` | 5 minutes |
| `/api/validators/:id` | `validator_detail:id` | 2 minutes |
| `/api/epoch/current` | `epoch_info` | 30 seconds |
| `/api/network/stats` | `network_stats` | 5 minutes |
| `/api/stake-accounts/:wallet` | `wallet_stake_accounts:wallet` | 3 minutes |

### Cache Admin Endpoints

#### `POST /admin/cache/flush`
Manually flush all cached data.

```bash
curl -X POST http://localhost:3001/admin/cache/flush
```

**Response:**
```json
{
  "success": true,
  "message": "Cache flushed successfully",
  "timestamp": 1677123456789
}
```

#### `GET /admin/cache/stats`
Get cache performance statistics.

```bash
curl http://localhost:3001/admin/cache/stats
```

**Response:**
```json
{
  "hits": 1247,
  "misses": 89,
  "hitRate": 93.33,
  "keys": 156,
  "memoryUsage": 1048576,
  "redisConnected": true,
  "timestamp": 1677123456789
}
```

### Configuration

Set `REDIS_URL` in your environment:

```bash
# Local Redis
REDIS_URL=redis://localhost:6379

# Redis with auth
REDIS_URL=redis://username:password@hostname:port

# Redis in Docker Compose
REDIS_URL=redis://redis-service:6379
```

**Fallback Behavior:**
- If Redis is unavailable, the API automatically falls back to in-memory caching
- All endpoints continue to work without Redis
- Cache statistics reflect the active caching layer

## 🧪 Development

```bash
# Type checking
npm run type-check

# Linting
npm run lint

# Run tests
npm run test

# Development with hot reload
npm run dev
```

## 🚢 Deployment

### Docker Support

Full Docker Compose setup with Redis included:

```bash
# Production deployment
docker-compose up -d

# Development with auto-rebuild
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Scale API instances
docker-compose up -d --scale api=3
```

**Environment Variables:**
```bash
# Required
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
REDIS_URL=redis://redis:6379

# Optional
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
```

### Environment Setup

1. Set `NODE_ENV=production`
2. Configure `SOLANA_RPC_URL` for your preferred RPC endpoint
3. Set appropriate `PORT` for your infrastructure
4. Consider RPC rate limiting for high-traffic deployments

## 📊 Performance Metrics

**Response Times with Redis Cache:**
- Health check: ~50ms
- Validator list (cached): ~20-50ms
- Validator list (RPC fetch): ~800-1200ms
- Single validator (cached): ~10-30ms
- Cache hit rate: 85-95% typical

**RPC Call Efficiency:**
- Single `getVoteAccounts` call for all validator data
- Batched validator-info program calls (100 per batch)
- Redis caching reduces RPC calls by 85-95%
- Intelligent cache invalidation based on data freshness

## 🎯 Production Considerations

### Rate Limiting
- Implement request rate limiting for public APIs
- Consider RPC endpoint rate limits (varies by provider)
- Redis caching layer significantly reduces RPC load

### Monitoring
- Health endpoint for uptime monitoring
- RPC connection monitoring
- Response time tracking
- Error rate monitoring

### Security
- CORS configuration for cross-origin requests
- Input validation on query parameters  
- Rate limiting and DDoS protection
- API key authentication (if needed)

## 📈 Roadmap

- [x] Response caching with Redis
- [x] Docker containerization
- [ ] Validator performance analytics (APY calculations)
- [ ] Historical data endpoints
- [ ] WebSocket real-time updates  
- [ ] Prometheus metrics export
- [ ] Advanced filtering options
- [ ] Cache warming strategies

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js with TypeScript
- **Caching**: Redis with in-memory fallback
- **Blockchain**: @solana/web3.js
- **Development**: ts-node, Jest, ESLint
- **Production**: Compiled JavaScript, Docker
- **Testing**: Jest with Redis mocking

## 📄 License

MIT License - Built by Ross for Phase Labs

---

**Built for Phase Labs** - Providing validator analytics for the next generation of Solana staking products.