export class VerifySiweDto {
  message: string;
  signature: string;
}

export class NonceResponseDto {
  nonce: string;
}

export class AuthResponseDto {
  accessToken: string;
  address: string;
  userId: string;
  role: string;
}
