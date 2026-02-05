import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SiweMessage } from 'siwe';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UsersService, WalletRole } from '../users/users.service';

interface UserWallet {
  userId: string;
  walletId: string;
  role: string;
  circleWallet?: {
    [blockchain: string]: string;
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
      let userWallet = await this.findUserByAddress(address);
      
      if (!userWallet) {
        console.log('User not found for address:', address);
        console.log('Auto-creating new user wallet...');
        
        try {
          // Generate userId based on address
          const userId = `user-${address.slice(2, 10)}`;
          
          // Use UsersService to create wallet (handles Circle wallet and JSON updates)
          await this.usersService.getOrCreateWallet(
            userId,
            WalletRole.INVESTOR,
            ['ARC-TESTNET', 'ARB-SEPOLIA', 'MATIC-AMOY', 'ETH-SEPOLIA']
          );
          console.log('Wallet created for user:', userId);
          
          // Link the external MetaMask wallet
          await this.linkExternalWallet(userId, address);
          console.log('External wallet linked:', address);
          
          // Retrieve the newly created user wallet
          userWallet = await this.findUserByAddress(address);
          
          if (!userWallet) {
            throw new Error('Wallet created but not found in storage');
          }
          
          console.log('New user wallet created:', {
            userId: userWallet.userId,
            role: userWallet.role,
          });
        } catch (createError) {
          console.error('Failed to create user wallet:', createError);
          throw new NotFoundException('User wallet not found and auto-creation failed');
        }
      }
      
      console.log('User found:', {
        userId: userWallet.userId,
        role: userWallet.role,
      });

      // Update last login time
      await this.updateLastLogin(userWallet.userId);
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
   * Find user by wallet address (supports both Circle wallet and external wallets)
   */
  private async findUserByAddress(address: string): Promise<UserWallet | null> {
    try {
      const fileContent = await fs.readFile(this.userWalletsPath, 'utf-8');
      const wallets: UserWallet[] = JSON.parse(fileContent);
      
      const normalizedAddress = address.toLowerCase();
      
      return wallets.find(wallet => {
        // Check Circle wallet
        if (wallet.circleWallet['ARC-TESTNET']?.toLowerCase() === normalizedAddress) {
          return true;
        }
        // Check external wallets (array of strings)
        return wallet.externalWallets?.some(
          ext => ext?.toLowerCase() === normalizedAddress
        );
      }) || null;
    } catch (error) {
      console.error('Error reading user wallets:', error);
      return null;
    }
  }

  /**
   * Link external wallet to user account
   */
  async linkExternalWallet(userId: string, address: string): Promise<boolean> {
    try {
      const fileContent = await fs.readFile(this.userWalletsPath, 'utf-8');
      const wallets: UserWallet[] = JSON.parse(fileContent);
      
      const wallet = wallets.find(w => w.userId === userId);
      if (!wallet) {
        return false;
      }

      const normalizedAddress = address.toLowerCase();
      
      // Check if address is already linked to this or another user
      const existingUser = await this.findUserByAddress(normalizedAddress);
      if (existingUser && existingUser.userId !== userId) {
        throw new Error('Address already linked to another account');
      }

      // Check if already linked to this user
      const alreadyLinked = wallet.externalWallets?.some(
        ext => ext.toLowerCase() === normalizedAddress
      );
      if (alreadyLinked) {
        return true;
      }

      // Add external wallet
      if (!wallet.externalWallets) {
        wallet.externalWallets = [];
      }
      wallet.externalWallets.push(normalizedAddress);

      // Save back to file
      await fs.writeFile(
        this.userWalletsPath,
        JSON.stringify(wallets, null, 2),
        'utf-8'
      );

      return true;
    } catch (error) {
      console.error('Error linking external wallet:', error);
      throw error;
    }
  }

  /**
   * Update last login time
   */
  private async updateLastLogin(userId: string): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.userWalletsPath, 'utf-8');
      const wallets: UserWallet[] = JSON.parse(fileContent);
      
      const wallet = wallets.find(w => w.userId === userId);
      if (wallet) {
        wallet.lastLogin = new Date().toISOString();
        await fs.writeFile(
          this.userWalletsPath,
          JSON.stringify(wallets, null, 2),
          'utf-8'
        );
      }
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
