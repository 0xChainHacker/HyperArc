import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SiweMessage } from 'siwe';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UsersService, WalletRole, ChainWallet } from '../users/users.service';

interface UserWallet {
  userId: string;
  role: string;
  circleWallet: {
    [blockchain: string]: ChainWallet;
  };
  externalWallets?: string[]; // Array of address strings
  lastLogin?: string;
  state?: string;
  createdAt?: string;
}

@Injectable()
export class AuthService {
  private nonces: Map<string, { nonce: string; timestamp: number }> = new Map();
  private readonly NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private readonly userWalletsPath = path.join(process.cwd(), 'data', 'user-wallets.json');

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {
    // Clean up expired nonces every minute
    setInterval(() => this.cleanExpiredNonces(), 60 * 1000);
  }

  /**
   * Generate a new nonce for SIWE authentication
   */
  generateNonce(): string {
    console.log('=== Generating New Nonce ===');
    const nonce = this.generateRandomNonce();
    const timestamp = Date.now();
    
    console.log('Generated nonce:', nonce);
    console.log('Timestamp:', timestamp, '(', new Date(timestamp).toISOString(), ')');
    
    // Store nonce with timestamp
    this.nonces.set(nonce, { nonce, timestamp });
    
    console.log('Nonce stored successfully');
    console.log('Total nonces in memory:', this.nonces.size);
    console.log('All nonces:', Array.from(this.nonces.keys()));
    console.log('=== Nonce Generation Complete ===');
    
    return nonce;
  }

  /**
   * Verify SIWE message and signature, then return JWT
   */
  async verifySiweAndGenerateToken(message: string, signature: string): Promise<{
    accessToken: string;
    address: string;
    userId: string;
    role: string;
  }> {
    try {
      console.log('=== SIWE Verification Started ===');
      console.log('Message:', message);
      console.log('Signature:', signature);
      
      // Parse SIWE message
      const siweMessage = new SiweMessage(message);
      console.log('Parsed SIWE Message:', {
        address: siweMessage.address,
        domain: siweMessage.domain,
        nonce: siweMessage.nonce,
        chainId: siweMessage.chainId,
        issuedAt: siweMessage.issuedAt,
      });
      
      // Early existence check: normalize address and ensure user exists.
      const earlyAddress = siweMessage.address.toLowerCase();
      console.log('Early existence check for address:', earlyAddress);
      const earlyUser = this.usersService.findUserByAddress(earlyAddress);
      if (!earlyUser) {
        console.log('User not found (early check) for address:', earlyAddress);
        // Do NOT auto-create here; return NotFound so frontend can create explicitly.
        throw new NotFoundException(
          `User wallet not found for address ${earlyAddress}. Create one by POST /wallets/:userId?role=investor|issuer&externalWallets=${earlyAddress}`
        );
      }

      // Verify the nonce exists and is not expired
      const storedNonce = this.nonces.get(siweMessage.nonce);
      console.log('Nonce validation:', {
        provided: siweMessage.nonce,
        found: !!storedNonce,
        timestamp: storedNonce?.timestamp,
      });
      
      if (!storedNonce) {
        throw new UnauthorizedException('Invalid or expired nonce');
      }

      // Verify signature
      console.log('Verifying signature...');
      try {
        const fields = await siweMessage.verify({ signature });
        console.log('Signature verification result:', {
          success: fields.success,
          data: fields.data,
        });
        
        if (!fields.success) {
          throw new UnauthorizedException('Invalid signature');
        }
      } catch (verifyError) {
        console.error('Signature verification error:', {
          error: verifyError,
          message: verifyError?.message,
          stack: verifyError?.stack,
          name: verifyError?.name,
          toString: verifyError?.toString(),
        });
        throw new UnauthorizedException(`Signature verification failed: ${verifyError?.message || verifyError}`);
      }

      // Remove used nonce
      this.nonces.delete(siweMessage.nonce);
      console.log('Nonce removed after successful verification');

      // Normalize address to lowercase
      const address = siweMessage.address.toLowerCase();
      console.log('Address normalized:', {
        original: siweMessage.address,
        normalized: address,
      });

      // Check if user exists in user-wallets.json
      console.log('Looking up user by address:', address);
      let userWallet = this.usersService.findUserByAddress(address);
      
      if (!userWallet) {
        console.log('User not found for address:', address);
        // Do NOT auto-create a wallet here. Let the frontend call POST /wallets/:userId
        // to create a wallet explicitly (include externalWallets query param to link addresses).
        throw new NotFoundException(
          `User wallet not found for address ${address}. Create one by POST /wallets/:userId?role=investor|issuer&externalWallets=${address}`
        );
      }
      
      console.log('User found:', {
        userId: userWallet.userId,
        role: userWallet.role,
      });

      // Update last login time
      await this.usersService.updateLastLogin(userWallet.userId, userWallet.role);
      console.log('Last login updated');

      // Generate JWT
      const payload = {
        address,
        userId: userWallet.userId,
        role: userWallet.role,
      };
      console.log('JWT payload:', payload);

      const accessToken = this.jwtService.sign(payload);
      console.log('JWT generated successfully');
      console.log('=== SIWE Verification Completed ===');

      return {
        accessToken,
        address,
        userId: userWallet.userId,
        role: userWallet.role,
      };
    } catch (error) {
      console.log('=== SIWE Verification Failed ===');
      console.error('Error type:', typeof error);
      console.error('Error:', error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Error name:', error?.name);
      console.error('Error toString:', error?.toString ? error.toString() : 'no toString');
      
      if (error instanceof UnauthorizedException || error instanceof NotFoundException) {
        throw error;
      }
      throw new UnauthorizedException(`SIWE verification failed: ${error?.message || JSON.stringify(error)}`);
    }
  }

  /**
   * Find user by wallet address (delegated to UsersService)
   */
  private findUserByAddress(address: string): UserWallet | null {
    return this.usersService.findUserByAddress(address);
  }

  /**
   * Link external wallet to user account (delegated to UsersService)
   */
  async linkExternalWallet(userId: string, address: string): Promise<boolean> {
    try {
      const normalizedAddress = address.toLowerCase();
      
      // Check if address is already linked to another user
      const existingUser = this.usersService.findUserByAddress(normalizedAddress);
      if (existingUser && existingUser.userId !== userId) {
        throw new Error('Address already linked to another account');
      }

      // Link wallet (assumes investor role for now)
      return await this.usersService.linkExternalWallet(userId, WalletRole.INVESTOR, normalizedAddress);
    } catch (error) {
      console.error('Error linking external wallet:', error);
      throw error;
    }
  }

  /**
   * Update last login time (delegated to UsersService)
   */
  private async updateLastLogin(userId: string, role: WalletRole): Promise<void> {
    try {
      await this.usersService.updateLastLogin(userId, role);
    } catch (error) {
      console.error('Error updating last login:', error);
    }
  }

  /**
   * Generate a random nonce
   */
  private generateRandomNonce(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Clean up expired nonces
   */
  private cleanExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, data] of this.nonces.entries()) {
      if (now - data.timestamp > this.NONCE_EXPIRY) {
        this.nonces.delete(nonce);
      }
    }
  }

  /**
   * Validate JWT token (used by JWT strategy)
   */
  async validateToken(payload: any) {
    return {
      address: payload.address,
      userId: payload.userId,
      role: payload.role,
    };
  }
}
