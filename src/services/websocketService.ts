/**
 * WebSocket Service
 * Real-time validator updates and notifications
 */

import WebSocket from 'ws';
import { Server as HTTPServer } from 'http';
import { ValidatorService } from './validatorService';
import { 
  ValidatorUpdateEvent, 
  ValidatorPerformanceUpdate, 
  DelinquencyAlert, 
  CommissionChangeNotification 
} from '../types/validator';

export class WebSocketService {
  private wss: WebSocket.Server;
  private validatorService: ValidatorService;
  private clients: Set<WebSocket> = new Set();
  private subscriptions: Map<WebSocket, Set<string>> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastValidatorStates: Map<string, any> = new Map();

  constructor(server: HTTPServer, validatorService: ValidatorService) {
    this.validatorService = validatorService;
    
    // Create WebSocket server
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws',
      perMessageDeflate: false
    });

    this.setupWebSocketHandlers();
    this.startMonitoring();
  }

  private setupWebSocketHandlers() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log(`New WebSocket connection from ${req.socket.remoteAddress}`);
      
      this.clients.add(ws);
      this.subscriptions.set(ws, new Set());
      
      // Send welcome message
      this.sendMessage(ws, {
        type: 'connection_established',
        message: 'Connected to Validator Analytics WebSocket',
        timestamp: Date.now()
      });

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
          this.sendMessage(ws, {
            type: 'error',
            message: 'Invalid message format',
            timestamp: Date.now()
          });
        }
      });

      // Handle connection close
      ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });
    });

    console.log('WebSocket server setup complete on /ws');
  }

  private handleClientMessage(ws: WebSocket, message: any) {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(ws, message);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(ws, message);
        break;
      case 'ping':
        this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        this.sendMessage(ws, {
          type: 'error',
          message: `Unknown message type: ${message.type}`,
          timestamp: Date.now()
        });
    }
  }

  private handleSubscribe(ws: WebSocket, message: any) {
    const { voteAccount, events } = message;
    
    if (!voteAccount) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'voteAccount is required for subscription',
        timestamp: Date.now()
      });
      return;
    }

    const validEvents = ['performance', 'delinquency', 'commission'];
    const subscribeTo = events || validEvents;
    
    // Validate event types
    const invalidEvents = subscribeTo.filter((event: string) => !validEvents.includes(event));
    if (invalidEvents.length > 0) {
      this.sendMessage(ws, {
        type: 'error',
        message: `Invalid event types: ${invalidEvents.join(', ')}`,
        validEvents,
        timestamp: Date.now()
      });
      return;
    }

    // Add subscriptions
    const clientSubscriptions = this.subscriptions.get(ws) || new Set();
    subscribeTo.forEach((event: string) => {
      clientSubscriptions.add(`${voteAccount}:${event}`);
    });
    this.subscriptions.set(ws, clientSubscriptions);

    this.sendMessage(ws, {
      type: 'subscribed',
      voteAccount,
      events: subscribeTo,
      message: `Subscribed to ${subscribeTo.length} event types for validator ${voteAccount}`,
      timestamp: Date.now()
    });

    console.log(`Client subscribed to ${subscribeTo.join(', ')} for validator ${voteAccount}`);
  }

  private handleUnsubscribe(ws: WebSocket, message: any) {
    const { voteAccount, events } = message;
    
    const clientSubscriptions = this.subscriptions.get(ws);
    if (!clientSubscriptions) return;

    if (voteAccount && events) {
      // Unsubscribe from specific events for a validator
      events.forEach((event: string) => {
        clientSubscriptions.delete(`${voteAccount}:${event}`);
      });
    } else if (voteAccount) {
      // Unsubscribe from all events for a validator
      const toRemove = Array.from(clientSubscriptions).filter(sub => sub.startsWith(`${voteAccount}:`));
      toRemove.forEach(sub => clientSubscriptions.delete(sub));
    } else {
      // Unsubscribe from all
      clientSubscriptions.clear();
    }

    this.sendMessage(ws, {
      type: 'unsubscribed',
      voteAccount,
      events,
      timestamp: Date.now()
    });
  }

  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(event: ValidatorUpdateEvent) {
    const eventKey = `${event.voteAccount}:${event.type.split('_')[0]}`;
    
    this.clients.forEach(ws => {
      const subscriptions = this.subscriptions.get(ws);
      if (subscriptions && subscriptions.has(eventKey)) {
        this.sendMessage(ws, event);
      }
    });
  }

  private startMonitoring() {
    // Monitor validators every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkValidatorUpdates();
      } catch (error) {
        console.error('Error during validator monitoring:', error);
      }
    }, 30000); // 30 seconds

    console.log('Validator monitoring started (30s intervals)');
  }

  private async checkValidatorUpdates() {
    try {
      // Get current validator data
      const validatorData = await this.validatorService.getValidators();
      
      // Check each validator for changes
      for (const validator of validatorData.validators) {
        const voteAccount = validator.identity;
        const lastState = this.lastValidatorStates.get(voteAccount);
        
        if (!lastState) {
          // First time seeing this validator, just store state
          this.lastValidatorStates.set(voteAccount, {
            commission: validator.commission,
            epochVoteAccount: validator.epochVoteAccount,
            lastVote: validator.lastVote
          });
          continue;
        }

        // Check for commission changes
        if (lastState.commission !== validator.commission) {
          const event: ValidatorUpdateEvent = {
            type: 'commission_change',
            voteAccount,
            data: {
              voteAccount,
              validatorName: validator.name,
              oldCommission: lastState.commission,
              newCommission: validator.commission,
              epoch: validatorData.epoch
            } as CommissionChangeNotification,
            timestamp: Date.now()
          };
          
          this.broadcast(event);
        }

        // Check for delinquency changes
        const wasActive = lastState.epochVoteAccount;
        const isActive = validator.epochVoteAccount;
        
        if (wasActive && !isActive) {
          // Validator became delinquent
          const event: ValidatorUpdateEvent = {
            type: 'delinquency_alert',
            voteAccount,
            data: {
              voteAccount,
              validatorName: validator.name,
              delinquent: true,
              missedSlots: 0 // Would need more detailed tracking
            } as DelinquencyAlert,
            timestamp: Date.now()
          };
          
          this.broadcast(event);
        } else if (!wasActive && isActive) {
          // Validator recovered from delinquency
          const event: ValidatorUpdateEvent = {
            type: 'delinquency_alert',
            voteAccount,
            data: {
              voteAccount,
              validatorName: validator.name,
              delinquent: false,
              missedSlots: 0
            } as DelinquencyAlert,
            timestamp: Date.now()
          };
          
          this.broadcast(event);
        }

        // Check for performance updates (voting activity)
        if (lastState.lastVote !== validator.lastVote) {
          const event: ValidatorUpdateEvent = {
            type: 'validator_performance',
            voteAccount,
            data: {
              voteAccount,
              currentSlot: validator.lastVote || 0,
              lastVote: validator.lastVote,
              skipRate: 0, // Would need detailed calculation
              creditsEarned: 0 // Would need epoch credits tracking
            } as ValidatorPerformanceUpdate,
            timestamp: Date.now()
          };
          
          this.broadcast(event);
        }

        // Update stored state
        this.lastValidatorStates.set(voteAccount, {
          commission: validator.commission,
          epochVoteAccount: validator.epochVoteAccount,
          lastVote: validator.lastVote
        });
      }

    } catch (error) {
      console.error('Error checking validator updates:', error);
    }
  }

  public getConnectionStats() {
    return {
      connectedClients: this.clients.size,
      totalSubscriptions: Array.from(this.subscriptions.values())
        .reduce((total, subs) => total + subs.size, 0),
      monitoredValidators: this.lastValidatorStates.size
    };
  }

  public close() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.clients.forEach(ws => {
      ws.close();
    });
    
    this.wss.close();
    console.log('WebSocket service closed');
  }
}