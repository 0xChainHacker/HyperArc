import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { VerifySiweDto, NonceResponseDto, AuthResponseDto } from './dto/verify-siwe.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from './decorators/user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /auth/nonce
   * Generate a new nonce for SIWE authentication
   */
  @Get('nonce')
  getNonce(): NonceResponseDto {
    console.log('\n[Controller] GET /auth/nonce - Request received');
    const nonce = this.authService.generateNonce();
    console.log('[Controller] Returning nonce to client:', nonce);
    return { nonce };
  }

  /**
   * POST /auth/verify
   * Verify SIWE signature and return JWT token
   * 
   * Request body:
   * {
   *   "message": "localhost:3000 wants you to sign in with your Ethereum account...",
   *   "signature": "0x..."
   * }
   * 
   * Response:
   * {
   *   "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
   *   "address": "0x...",
   *   "userId": "user123",
   *   "role": "investor"
   * }
   */
  @Post('verify')
  async verifySiwe(@Body() verifySiweDto: VerifySiweDto): Promise<AuthResponseDto> {
    console.log('\n[Controller] POST /auth/verify - Request received');
    console.log('[Controller] Message length:', verifySiweDto.message?.length);
    console.log('[Controller] Signature length:', verifySiweDto.signature?.length);
    
    const result = await this.authService.verifySiweAndGenerateToken(
      verifySiweDto.message,
      verifySiweDto.signature,
    );
    
    console.log('[Controller] Verification successful, returning JWT');
    return result;
  }

  /**
   * POST /auth/link-wallet
   * Link external wallet (MetaMask) to existing user account
   * Requires JWT authentication
   * 
   * Request body:
   * {
   *   "message": "SIWE message...",
   *   "signature": "0x..."
   * }
   */
  @Post('link-wallet')
  @UseGuards(JwtAuthGuard)
  async linkWallet(
    @User() user: any,
    @Body() verifySiweDto: VerifySiweDto,
  ): Promise<{ success: boolean; message: string }> {
    const { SiweMessage } = await import('siwe');
    
    // Parse and verify SIWE message
    const siweMessage = new SiweMessage(verifySiweDto.message);
    const fields = await siweMessage.verify({ signature: verifySiweDto.signature });
    
    if (!fields.success) {
      return { success: false, message: 'Invalid signature' };
    }

    // Link the verified address to current user
    const address = siweMessage.address.toLowerCase();
    await this.authService.linkExternalWallet(user.userId, address);

    return { 
      success: true, 
      message: `Wallet ${address} linked successfully` 
    };
  }
}
