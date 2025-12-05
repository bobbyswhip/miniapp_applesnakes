// Shared nonce store for SIWE authentication
// In production, use Redis or another distributed cache

interface NonceEntry {
  nonce: string;
  expires: number;
}

class NonceStore {
  private store: Map<string, NonceEntry>;

  constructor() {
    this.store = new Map();

    // Clean up expired nonces every minute
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanup(), 60000);
    }
  }

  set(nonce: string, expiresInMs: number = 5 * 60 * 1000): void {
    this.store.set(nonce, {
      nonce,
      expires: Date.now() + expiresInMs,
    });
  }

  get(nonce: string): NonceEntry | undefined {
    return this.store.get(nonce);
  }

  delete(nonce: string): boolean {
    return this.store.delete(nonce);
  }

  validate(nonce: string): boolean {
    const entry = this.store.get(nonce);
    if (!entry) return false;
    if (entry.expires < Date.now()) {
      this.store.delete(nonce);
      return false;
    }
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (value.expires < now) {
        this.store.delete(key);
      }
    }
  }
}

// Singleton instance
export const nonceStore = new NonceStore();
