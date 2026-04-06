import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { generateRandomBigInt } from 'telegram/Helpers';
import { Buffer } from 'buffer';

let clientInstance: TelegramClient | null = null;

export const getTelegramClient = async (session: string, apiId: string, apiHash: string) => {
  if (clientInstance && clientInstance.connected) {
    return clientInstance;
  }
  
  const connectWithTimeout = async (client: TelegramClient, timeoutMs: number = 30000) => {
    return Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeoutMs))
    ]);
  };

  if (clientInstance) {
    try {
      await connectWithTimeout(clientInstance);
      return clientInstance;
    } catch (e) {
      console.warn('Failed to reconnect existing client, creating new one', e);
    }
  }

  clientInstance = new TelegramClient(new StringSession(session), parseInt(apiId), apiHash, {
    connectionRetries: 5,
    useWSS: true,
    autoReconnect: true,
  });
  
  await connectWithTimeout(clientInstance);
  return clientInstance;
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
  // Use GramJS's built-in uploadFile which handles chunking and workers efficiently in the browser
  // It uses file.slice() internally which is the browser equivalent of streaming for files
  return await client.uploadFile({
    file,
    workers: 8,
    onProgress: (progress: number) => {
      if (onProgress) onProgress(progress);
    },
  });
};

/**
 * Downloads a file from Telegram using multiple workers
 */
export const downloadFile = async (
  client: TelegramClient,
  media: any,
  options: {
    progressCallback?: any;
    workers?: number;
  } = {}
) => {
  return (client as any).downloadFile(media, {
    progressCallback: options.progressCallback,
    workers: options.workers || 8, // Default to 8 workers for faster downloads
  });
};
