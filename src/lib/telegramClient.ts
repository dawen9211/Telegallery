import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Buffer } from 'buffer';

let clientInstance: TelegramClient | null = null;
let connectionPromise: Promise<TelegramClient> | null = null;

export const getTelegramClient = async (session: string, apiId: string, apiHash: string) => {
  // If we already have a connected instance, return it
  if (clientInstance && clientInstance.connected) {
    return clientInstance;
  }

  // If we are already connecting, wait for that promise
  if (connectionPromise) {
    return connectionPromise;
  }

  const connectWithTimeout = async (client: TelegramClient, timeoutMs: number = 30000) => {
    let timeoutId: any;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
    });

    try {
      await Promise.race([client.connect(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  connectionPromise = (async () => {
    try {
      if (clientInstance) {
        try {
          await connectWithTimeout(clientInstance);
          if (clientInstance.connected) {
            return clientInstance;
          }
        } catch (e) {
          console.warn('Failed to reconnect existing client, disconnecting and creating new one', e);
          await clientInstance.disconnect().catch(() => {});
          clientInstance = null;
        }
      }

      clientInstance = new TelegramClient(new StringSession(session), parseInt(apiId), apiHash, {
        connectionRetries: 5,
        useWSS: true,
        autoReconnect: true,
      });

      await connectWithTimeout(clientInstance);
      return clientInstance;
    } catch (error) {
      console.error('Failed to initialize Telegram client:', error);
      if (clientInstance) {
        await clientInstance.disconnect().catch(() => {});
        clientInstance = null;
      }
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
};

export const disconnectTelegramClient = async () => {
  if (clientInstance) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
};

export const uploadLargeFile = async (
  client: TelegramClient,
  file: File,
  onProgress?: (progress: number) => void
) => {
  try {
    // GramJS's uploadFile is much more robust than manual chunking
    // It handles both InputFile and InputFileBig internally
    return await client.uploadFile({
      file,
      workers: 4,
      onProgress: (progress: number) => {
        if (onProgress) onProgress(progress);
      },
    });
  } catch (err) {
    console.error('Error in uploadLargeFile:', err);
    throw err;
  }
};
