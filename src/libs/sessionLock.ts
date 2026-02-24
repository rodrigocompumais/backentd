import Redis from "ioredis";
import { logger } from "../utils/logger";

const redisUri = process.env.REDIS_URI || "";
const redis = redisUri ? new Redis(redisUri, { maxRetriesPerRequest: 2 }) : null;
const isDistributedLockEnabled = process.env.WBOT_ENABLE_DISTRIBUTED_LOCK === "true";

const LOCK_TTL_MS = Number(process.env.WBOT_LOCK_TTL_MS || 30000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WBOT_LOCK_HEARTBEAT_MS || 10000);

type LockHandle = {
  key: string;
  token: string;
  heartbeat?: NodeJS.Timeout;
};

const buildLockKey = (whatsappId: number): string => `wbot:lock:${whatsappId}`;

const startHeartbeat = (handle: LockHandle) => {
  if (!redis) return;
  handle.heartbeat = setInterval(async () => {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, handle.key, handle.token, `${LOCK_TTL_MS}`);
    } catch (error) {
      logger.warn("Falha ao renovar lock de sessão", { key: handle.key, error: (error as Error).message });
    }
  }, HEARTBEAT_INTERVAL_MS);
};

export const acquireSessionLock = async (whatsappId: number): Promise<LockHandle | null> => {
  if (!isDistributedLockEnabled) {
    return { key: buildLockKey(whatsappId), token: "lock-disabled-fallback" };
  }

  if (!redis) {
    return { key: buildLockKey(whatsappId), token: "in-memory-fallback" };
  }

  try {
    const key = buildLockKey(whatsappId);
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await redis.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (result !== "OK") {
      return null;
    }

    const handle: LockHandle = { key, token };
    startHeartbeat(handle);
    return handle;
  } catch (error) {
    logger.warn("Falha ao adquirir lock distribuído. Usando fallback local.", {
      whatsappId,
      error: (error as Error).message
    });
    return { key: buildLockKey(whatsappId), token: "redis-error-fallback" };
  }
};

export const releaseSessionLock = async (handle: LockHandle | null): Promise<void> => {
  if (!handle) return;
  if (handle.heartbeat) clearInterval(handle.heartbeat);
  if (
    !redis ||
    handle.token === "in-memory-fallback" ||
    handle.token === "lock-disabled-fallback" ||
    handle.token === "redis-error-fallback"
  ) {
    return;
  }

  try {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, handle.key, handle.token);
  } catch (error) {
    logger.warn("Falha ao liberar lock de sessão", { key: handle.key, error: (error as Error).message });
  }
};
