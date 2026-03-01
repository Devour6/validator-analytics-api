/**
 * OpenAPI/Swagger configuration for Validator Analytics API
 */

import swaggerJSDoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Validator Analytics API',
      version: '1.0.0',
      description: 'Solana Validator Analytics API - On-chain data only',
      termsOfService: 'https://phaselabs.io/terms',
      contact: {
        name: 'Phase Labs Support',
        url: 'https://phaselabs.io',
        email: 'support@phaselabs.io'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://validator-api.phaselabs.io' 
          : 'http://localhost:3001',
        description: process.env.NODE_ENV === 'production' 
          ? 'Production server' 
          : 'Development server'
      }
    ],
    components: {
      schemas: {
        Validator: {
          type: 'object',
          properties: {
            identity: {
              type: 'string',
              description: 'Validator identity public key',
              example: '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2'
            },
            voteAccount: {
              type: 'string',
              description: 'Vote account public key',
              example: 'AS3nKBQfKs8fJ8ncyHrdvo4FDT6S8HMRhD75JjCcyr1t'
            },
            commission: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Commission percentage',
              example: 7
            },
            epochVoteAccount: {
              type: 'boolean',
              description: 'Whether this validator has a vote account in current epoch',
              example: true
            },
            epochCredits: {
              type: 'number',
              description: 'Credits earned in current epoch',
              example: 98234
            },
            activatedStake: {
              type: 'string',
              description: 'Activated stake amount in lamports',
              example: '12345678901234567'
            },
            lastVote: {
              type: 'number',
              description: 'Last vote slot number',
              example: 123456789
            },
            rootSlot: {
              type: 'number', 
              description: 'Root slot number',
              example: 123456780
            }
          },
          required: ['identity', 'voteAccount', 'commission', 'epochVoteAccount']
        },
        ValidatorDetails: {
          allOf: [
            { $ref: '#/components/schemas/Validator' },
            {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Validator name from Keybase',
                  example: 'Phase Labs Validator'
                },
                keybaseUsername: {
                  type: 'string',
                  description: 'Keybase username',
                  example: 'phaselabs'
                },
                website: {
                  type: 'string',
                  format: 'uri',
                  description: 'Validator website URL',
                  example: 'https://phaselabs.io'
                },
                details: {
                  type: 'string',
                  description: 'Additional validator details',
                  example: 'High-performance validator with 99.9% uptime'
                },
                iconUrl: {
                  type: 'string',
                  format: 'uri',
                  description: 'Validator icon/logo URL',
                  example: 'https://keybase.io/_/api/1.0/user/lookup.json?usernames=phaselabs'
                }
              }
            }
          ]
        },
        ValidatorsResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                validators: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Validator' }
                },
                count: {
                  type: 'number',
                  description: 'Number of validators returned',
                  example: 50
                },
                totalStake: {
                  type: 'string',
                  description: 'Total stake across all returned validators in lamports',
                  example: '987654321098765432'
                },
                totalValidators: {
                  type: 'number',
                  description: 'Total number of validators in the network',
                  example: 1234
                }
              },
              required: ['validators', 'count']
            },
            rpcUrl: {
              type: 'string',
              description: 'RPC URL used for the request',
              example: 'https://api.mainnet-beta.solana.com'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp',
              example: '2024-02-28T10:30:00Z'
            }
          },
          required: ['success', 'data']
        },
        ValidatorPerformance: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                voteAccount: {
                  type: 'string',
                  example: 'AS3nKBQfKs8fJ8ncyHrdvo4FDT6S8HMRhD75JjCcyr1t'
                },
                performance: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      epoch: {
                        type: 'number',
                        example: 450
                      },
                      credits: {
                        type: 'number',
                        example: 98234
                      },
                      prevCredits: {
                        type: 'number',
                        example: 97890
                      }
                    }
                  }
                }
              }
            }
          }
        },
        StakeDistribution: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                walletAddress: {
                  type: 'string',
                  example: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
                },
                totalStake: {
                  type: 'string',
                  description: 'Total stake amount in lamports',
                  example: '5000000000'
                },
                stakes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      voteAccount: {
                        type: 'string',
                        example: 'AS3nKBQfKs8fJ8ncyHrdvo4FDT6S8HMRhD75JjCcyr1t'
                      },
                      stake: {
                        type: 'string',
                        description: 'Stake amount in lamports',
                        example: '1000000000'
                      },
                      activationEpoch: {
                        type: 'number',
                        example: 448
                      },
                      deactivationEpoch: {
                        type: 'number',
                        nullable: true,
                        example: null
                      }
                    }
                  }
                }
              }
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              example: 'Invalid Query Parameters'
            },
            message: {
              type: 'string',
              example: 'Request contains invalid parameters'
            },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    example: 'limit'
                  },
                  message: {
                    type: 'string',
                    example: '"limit" must be less than or equal to 1000'
                  }
                }
              }
            }
          },
          required: ['error', 'message']
        },
        RateLimitError: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              example: 'Too Many Requests'
            },
            message: {
              type: 'string',
              example: 'Rate limit exceeded. Please try again later.'
            },
            retryAfter: {
              type: 'string',
              example: '15 minutes'
            }
          },
          required: ['error', 'message', 'retryAfter']
        }
      },
      parameters: {
        limitParam: {
          name: 'limit',
          in: 'query',
          description: 'Maximum number of validators to return (1-1000)',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            default: 50
          }
        },
        sortByParam: {
          name: 'sortBy',
          in: 'query',
          description: 'Sort validators by field',
          required: false,
          schema: {
            type: 'string',
            enum: ['stake', 'commission', 'name'],
            default: 'stake'
          }
        },
        orderParam: {
          name: 'order',
          in: 'query',
          description: 'Sort order',
          required: false,
          schema: {
            type: 'string',
            enum: ['asc', 'desc'],
            default: 'desc'
          }
        },
        activeOnlyParam: {
          name: 'activeOnly',
          in: 'query',
          description: 'Return only active validators',
          required: false,
          schema: {
            type: 'boolean',
            default: false
          }
        },
        voteAccountParam: {
          name: 'voteAccount',
          in: 'path',
          description: 'Validator vote account public key (base58)',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[1-9A-HJ-NP-Za-km-z]+$',
            minLength: 32,
            maxLength: 44
          }
        },
        walletAddressParam: {
          name: 'walletAddress',
          in: 'path',
          description: 'Wallet address public key (base58)',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[1-9A-HJ-NP-Za-km-z]+$',
            minLength: 32,
            maxLength: 44
          }
        }
      },
      responses: {
        BadRequest: {
          description: 'Invalid request parameters',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Not Found' },
                  message: { type: 'string', example: 'Validator not found' }
                }
              }
            }
          }
        },
        TooManyRequests: {
          description: 'Rate limit exceeded',
          headers: {
            'Retry-After': {
              description: 'Seconds to wait before making a new request',
              schema: { type: 'integer' }
            },
            'X-RateLimit-Limit': {
              description: 'Request limit per time window',
              schema: { type: 'integer' }
            },
            'X-RateLimit-Remaining': {
              description: 'Remaining requests in current window',
              schema: { type: 'integer' }
            },
            'X-RateLimit-Reset': {
              description: 'Time when rate limit resets (Unix timestamp)',
              schema: { type: 'integer' }
            }
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RateLimitError' }
            }
          }
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Internal Server Error' },
                  message: { type: 'string', example: 'An unexpected error occurred' }
                }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Validators',
        description: 'Validator information and analytics'
      },
      {
        name: 'Performance',
        description: 'Validator performance metrics'
      },
      {
        name: 'Stake',
        description: 'Stake distribution and delegation data'
      },
      {
        name: 'Health',
        description: 'API health and status'
      }
    ],
    paths: {
      '/': {
        get: {
          tags: ['Health'],
          summary: 'API status and information',
          description: 'Returns basic API information and health status',
          responses: {
            '200': {
              description: 'API information',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Validator Analytics API v1.0.0' },
                      version: { type: 'string', example: '1.0.0' },
                      documentation: { type: 'string', example: '/docs' },
                      endpoints: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['/validators', '/validator/:voteAccount', '/performance/:voteAccount']
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check endpoint',
          description: 'Returns API health status and RPC connectivity',
          responses: {
            '200': {
              description: 'API is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'healthy' },
                      timestamp: { type: 'string', format: 'date-time' },
                      rpc: {
                        type: 'object',
                        properties: {
                          connected: { type: 'boolean', example: true },
                          url: { type: 'string', example: 'https://api.mainnet-beta.solana.com' },
                          latency: { type: 'number', example: 45 }
                        }
                      }
                    }
                  }
                }
              }
            },
            '503': {
              description: 'API is unhealthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'unhealthy' },
                      timestamp: { type: 'string', format: 'date-time' },
                      error: { type: 'string', example: 'RPC connection failed' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/validators': {
        get: {
          tags: ['Validators'],
          summary: 'Get validators list',
          description: 'Returns a list of Solana validators with optional filtering and sorting',
          parameters: [
            { $ref: '#/components/parameters/limitParam' },
            { $ref: '#/components/parameters/sortByParam' },
            { $ref: '#/components/parameters/orderParam' },
            { $ref: '#/components/parameters/activeOnlyParam' }
          ],
          responses: {
            '200': {
              description: 'List of validators',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ValidatorsResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '429': { $ref: '#/components/responses/TooManyRequests' },
            '500': { $ref: '#/components/responses/InternalServerError' }
          }
        }
      },
      '/validator/{voteAccount}': {
        get: {
          tags: ['Validators'],
          summary: 'Get validator details',
          description: 'Returns detailed information for a specific validator by vote account',
          parameters: [
            { $ref: '#/components/parameters/voteAccountParam' }
          ],
          responses: {
            '200': {
              description: 'Validator details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { $ref: '#/components/schemas/ValidatorDetails' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '404': { $ref: '#/components/responses/NotFound' },
            '429': { $ref: '#/components/responses/TooManyRequests' },
            '500': { $ref: '#/components/responses/InternalServerError' }
          }
        }
      },
      '/performance/{voteAccount}': {
        get: {
          tags: ['Performance'],
          summary: 'Get validator performance',
          description: 'Returns performance history for a specific validator',
          parameters: [
            { $ref: '#/components/parameters/voteAccountParam' }
          ],
          responses: {
            '200': {
              description: 'Validator performance data',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ValidatorPerformance' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '404': { $ref: '#/components/responses/NotFound' },
            '429': { $ref: '#/components/responses/TooManyRequests' },
            '500': { $ref: '#/components/responses/InternalServerError' }
          }
        }
      },
      '/stake/{walletAddress}': {
        get: {
          tags: ['Stake'],
          summary: 'Get stake distribution',
          description: 'Returns stake distribution for a specific wallet address',
          parameters: [
            { $ref: '#/components/parameters/walletAddressParam' }
          ],
          responses: {
            '200': {
              description: 'Stake distribution data',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StakeDistribution' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '404': { $ref: '#/components/responses/NotFound' },
            '429': { $ref: '#/components/responses/TooManyRequests' },
            '500': { $ref: '#/components/responses/InternalServerError' }
          }
        }
      }
    }
  },
  apis: ['./src/server.ts'] // Path to the API files for additional JSDoc comments
};

export const specs = swaggerJSDoc(options);