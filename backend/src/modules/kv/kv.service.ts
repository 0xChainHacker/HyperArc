import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
let RedisClass: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  RedisClass = require('@upstash/redis').Redis;
} catch (err) {
  RedisClass = null;
}

@Injectable()
export class KVService {
  private readonly logger = new Logger(KVService.name);
  private client: any = null;
  private available = false;
  private restUrl: string | null = null;
  private restToken: string | null = null;
  private restAvailable = false;

  constructor() {
    // Support multiple env var names (users may provide Upstash / custom names)
    const url = process.env.KV_REST_URL || process.env.KV_REST_API_URL || process.env.VERCEL_KV_URL || process.env.KV_URL || process.env.REDIS_URL;
    const token = process.env.KV_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_TOKEN || process.env.KV_TOKEN;

    // Try Upstash Redis client (official usage: `new Redis({ url, token })`)
    if (RedisClass && url && token) {
      try {
        this.client = new RedisClass({ url, token });
        this.available = true;
        this.logger.log('Upstash Redis client initialized');
      } catch (err: any) {
        this.logger.warn('Failed to initialize Upstash Redis client', err?.message || err);
      }
    }

    // REST fallback (Upstash-like REST API)
    this.restUrl = process.env.KV_REST_API_URL || process.env.KV_REST_URL || process.env.KV_URL || null;
    this.restToken = process.env.KV_REST_API_TOKEN || process.env.KV_REST_TOKEN || process.env.KV_TOKEN || null;
    if (!this.available && this.restUrl && this.restToken) {
      this.restAvailable = true;
      this.available = true; // expose as available when REST fallback is configured
      this.logger.log('Upstash REST fallback enabled');
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      if (this.client) {
        return await this.client.get(key);
      }

      if (this.restAvailable && this.restUrl && this.restToken) {
        // Upstash-style REST get: POST {restUrl}/get/{key}
        const url = `${this.restUrl.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`;
        const resp = await axios.get(url, {
          headers: { Authorization: `Bearer ${this.restToken}` },
          timeout: 5000,
        });
        const data = resp?.data;
        let result = data?.result ?? null;
        if (typeof result === 'string') {
          try {
            const parsed = JSON.parse(result);
            if (parsed && parsed.value !== undefined) {
              return typeof parsed.value === 'string' ? parsed.value : JSON.stringify(parsed.value);
            }
            return result;
          } catch (_) {
            return result;
          }
        }
        if (result && result.value !== undefined) {
          return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
        }
        return null;
      }

      return null;
    } catch (err: any) {
      this.logger.warn('KV get failed', err?.message || err);
      return null;
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      if (this.client) {
        await this.client.set(key, value);
        return true;
      }

      if (this.restAvailable && this.restUrl && this.restToken) {
        const url = `${this.restUrl.replace(/\/$/, '')}/set/${encodeURIComponent(key)}`;
        const resp = await axios.post(url, { value }, {
          headers: { Authorization: `Bearer ${this.restToken}`, 'Content-Type': 'application/json' },
          timeout: 5000,
        });
        return resp.status >= 200 && resp.status < 300;
      }

      return false;
    } catch (err: any) {
      this.logger.warn('KV set failed', err?.message || err);
      return false;
    }
  }
}
