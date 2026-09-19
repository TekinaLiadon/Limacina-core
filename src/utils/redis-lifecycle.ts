import { Logger } from "@nestjs/common";

export const REDIS_COMMAND_TIMEOUT_MS = 500;
export const REDIS_FAILURE_LOG_INTERVAL = 100;
export const REDIS_RECONNECT_DELAY_MS = 5_000;

export interface RedisLifecycleClient {
  connect?(): Promise<void>;
  close(): void;
  onconnect?: (() => void) | null;
  onclose?: ((error: Error) => void) | null;
}

export interface RedisLifecycleMessages {
  onclose: string;
  onconnect: string;
  recovered: string;
  failure: string;
}

export class RedisClientLifecycle {
  private consecutiveFailures = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: RedisLifecycleClient,
    private readonly logger: Logger,
    private readonly messages: RedisLifecycleMessages,
    private readonly reconnectDelayMs: number = REDIS_RECONNECT_DELAY_MS,
  ) {
    this.client.onclose = (error: Error) => {
      this.logger.error({ err: error }, this.messages.onclose);
      this.scheduleReconnect();
    };
    this.client.onconnect = () => {
      this.clearReconnectTimer();
      this.logger.log(this.messages.onconnect);
    };
  }

  dispose(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.client.close();
  }

  async withTimeout<T>(operation: Promise<T>, action: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiration = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Redis ${action} не ответил за ${REDIS_COMMAND_TIMEOUT_MS} мс`)),
        REDIS_COMMAND_TIMEOUT_MS,
      );
    });

    try {
      return await Promise.race([operation, expiration]);
    } catch (error) {
      operation.catch(() => {});
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  reportSuccess(): void {
    if (this.consecutiveFailures === 0) return;

    this.logger.log({ skippedFailures: this.consecutiveFailures }, this.messages.recovered);
    this.consecutiveFailures = 0;
  }

  reportFailure(error: unknown, context: Record<string, unknown> = {}): void {
    this.consecutiveFailures += 1;
    if (
      this.consecutiveFailures !== 1 &&
      this.consecutiveFailures % REDIS_FAILURE_LOG_INTERVAL !== 0
    ) {
      return;
    }

    this.logger.error(
      { err: error, ...context, consecutiveFailures: this.consecutiveFailures },
      this.messages.failure,
    );
  }

  private scheduleReconnect(): void {
    const { connect } = this.client;
    if (this.closed || this.reconnectTimer !== undefined || !connect) return;

    const reconnect = connect.bind(this.client);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      reconnect().catch((error: unknown) => {
        this.logger.error({ err: error }, "Переподключение к Redis не удалось");
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
