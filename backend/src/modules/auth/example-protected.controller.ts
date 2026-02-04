import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';

/**
 * Example: How to use JWT authentication in other Controllers
 * 
 * This file demonstrates how to protect API endpoints to allow only authenticated users
 */
@Controller('example')
export class ExampleProtectedController {
  
  /**
   * Protected endpoint example
   * Requires valid JWT token in Header
   * Authorization: Bearer <token>
   */
  @Get('protected')
  @UseGuards(JwtAuthGuard)
  async getProtectedData(@User() user: any) {
    // User object contains:
    // - user.address: Wallet address
    // - user.userId: User ID
    // - user.role: Role (investor/issuer)
    
    return {
      message: 'This is protected data',
      user: {
        address: user.address,
        userId: user.userId,
        role: user.role,
      },
    };
  }

  /**
   * Public endpoint example
   * No authentication required
   */
  @Get('public')
  async getPublicData() {
    return {
      message: 'This is public data',
    };
  }
}
