/**
 * Test Server Setup
 * Proper server lifecycle management for tests
 */

import { Server } from 'http';
import app from '../server';

export class TestServer {
  private server: Server | null = null;
  
  async start(port: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = app.listen(port, (err?: Error) => {
        if (err) {
          reject(err);
          return;
        }
        
        const actualPort = (this.server?.address() as any)?.port || port;
        console.log(`Test server started on port ${actualPort}`);
        resolve(actualPort);
      });
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      
      this.server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log('Test server stopped');
        this.server = null;
        resolve();
      });
    });
  }
  
  getServer(): Server | null {
    return this.server;
  }
}

export const testServer = new TestServer();