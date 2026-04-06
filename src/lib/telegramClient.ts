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
  const size = file.size;
  const name = file.name;
  const fileId = generateRandomBigInt();
  const isLarge = size > 10 * 1024 * 1024; // 10MB threshold

  const partSize = 512 * 1024; // 512KB chunks
  const partCount = Math.floor((size + partSize - 1) / partSize);

  const workers = 3; // Reduce to 3 concurrent requests to avoid overwhelming
  let uploadedParts = 0;

  if (onProgress) onProgress(0);

  for (let i = 0; i < partCount; i += workers) {
    const sendingParts = [];
    let end = i + workers;
    if (end > partCount) end = partCount;

    for (let j = i; j < end; j++) {
      let endPart = (j + 1) * partSize;
      if (endPart > size) endPart = size;

      if (endPart === j * partSize) break;

      // Read chunk directly from File
      const blob = file.slice(j * partSize, endPart);
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      sendingParts.push(
        (async (jMemo, bytesMemo) => {
          let retries = 0;
          while (true) {
            try {
              const request = isLarge
                ? new Api.upload.SaveBigFilePart({
                    fileId,
                    filePart: jMemo,
                    fileTotalParts: partCount,
                    bytes: bytesMemo,
                  })
                : new Api.upload.SaveFilePart({
                    fileId,
                    filePart: jMemo,
                    bytes: bytesMemo,
                  });

              // Use invoke to use the main connection, avoiding AUTH_KEY_DUPLICATED
              await client.invoke(request);

              uploadedParts++;
              if (onProgress) onProgress(uploadedParts / partCount);
              break;
            } catch (err: any) {
              if (err.errorMessage === 'FLOOD_WAIT') {
                await new Promise((resolve) => setTimeout(resolve, err.seconds * 1000));
                continue;
              }
              retries++;
              console.error(`Error uploading part ${jMemo} (attempt ${retries}):`, err);
              if (retries >= 3) throw err; // Retry up to 3 times as requested
              await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
            }
          }
        })(j, bytes)
      );
    }
    await Promise.all(sendingParts);
  }

  return isLarge
    ? new Api.InputFileBig({
        id: fileId,
        parts: partCount,
        name,
      })
    : new Api.InputFile({
        id: fileId,
        parts: partCount,
        name,
        md5Checksum: '',
      });
};
