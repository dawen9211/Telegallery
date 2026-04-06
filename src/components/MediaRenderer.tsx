import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Film, Loader2, Image as ImageIcon, Play, AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getTelegramClient } from '../lib/telegramClient';
import { Buffer } from 'buffer';
import bigInt from 'big-integer';
import { Api, utils } from 'telegram';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MediaRendererProps {
  fileId: string;
  type: 'photo' | 'video';
  name: string;
  botToken: string;
  edits?: any;
  overrideEdits?: any;
  className?: string;
  isThumbnail?: boolean;
  isLarge?: boolean;
  style?: React.CSSProperties;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  chatId?: string;
  messageId?: number;
  sessionString?: string;
  apiId?: string;
  apiHash?: string;
}

export const MediaRenderer: React.FC<MediaRendererProps> = ({ 
  fileId, 
  type, 
  name, 
  botToken, 
  edits, 
  overrideEdits,
  className,
  isThumbnail = false,
  isLarge = false,
  style,
  onLoad,
  chatId,
  messageId,
  sessionString,
  apiId,
  apiHash
}) => {
  const [url, setUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [bufferingProgress, setBufferingProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const cancelledRef = useRef(false);

  const activeEdits = overrideEdits || edits;

  useEffect(() => {
    if (!streaming || !url) return;

    const channel = new BroadcastChannel('tele_buffer');
    channel.onmessage = (event) => {
      if (event.data.url === url) {
        const percent = event.data.percent;
        const downloaded = event.data.downloaded;
        setBufferingProgress(percent);
        setDownloadedBytes(downloaded);

        // Threshold: 10% or 5MB
        if (!isReady && (percent >= 10 || downloaded >= 5 * 1024 * 1024)) {
          setIsReady(true);
        }
      }
    };

    return () => channel.close();
  }, [streaming, url, isReady]);

  useEffect(() => {
    if (isReady && videoRef.current && !isThumbnail) {
      videoRef.current.play().catch(err => console.warn('Auto-play failed:', err));
    }
  }, [isReady, isThumbnail]);

  useEffect(() => {
    let isMounted = true;
    let currentBlobUrl: string | null = null;

    const fetchUrl = async () => {
      if (isLarge && sessionString && chatId && messageId && apiId && apiHash) {
        setLoading(true);
        setIsReady(false);
        setBufferingProgress(0);
        setDownloadedBytes(0);
        try {
          const client = await getTelegramClient(sessionString, apiId, apiHash);
          
          const peer = chatId.match(/^-?\d+$/) ? BigInt(chatId) : chatId;
          const messages = await client.getMessages(peer, { ids: [messageId] });
          
          if (messages && messages.length > 0 && messages[0].media) {
            const media = messages[0].media;
            
            // Always try to get thumbnail first for videos to prioritize UI responsiveness
            if (type === 'video' && !isThumbnail) {
              try {
                let thumbBuffer: any = null;
                if ((media as any).document && (media as any).document.thumbs) {
                  const thumbs = (media as any).document.thumbs;
                  if (thumbs && thumbs.length > 0) {
                    thumbBuffer = await client.downloadMedia(media, { thumb: thumbs[thumbs.length - 1] });
                  }
                }
                if (thumbBuffer && isMounted) {
                  const thumbBlob = new Blob([thumbBuffer]);
                  setThumbnailUrl(URL.createObjectURL(thumbBlob));
                }
              } catch (e) {
                console.warn('Failed to pre-load video thumbnail', e);
              }
            }

            if (isThumbnail) {
              let buffer: any = null;
              // 1. Try to find thumbs in document
              if ((media as any).document && (media as any).document.thumbs) {
                const thumbs = (media as any).document.thumbs;
                if (thumbs && thumbs.length > 0) {
                  const thumbToDownload = thumbs[thumbs.length - 1];
                  try {
                    buffer = await client.downloadMedia(media, { thumb: thumbToDownload, workers: 8 } as any);
                  } catch (e) {
                    console.warn('Failed to download specific document thumb', e);
                  }
                }
              } 
              
              // 2. Try to find sizes in photo
              if (!buffer && (media as any).photo && (media as any).photo.sizes) {
                const sizes = (media as any).photo.sizes;
                if (sizes && sizes.length > 0) {
                  const thumbToDownload = sizes[Math.min(sizes.length - 1, 1)];
                  try {
                    buffer = await client.downloadMedia(media, { thumb: thumbToDownload, workers: 8 } as any);
                  } catch (e) {
                    console.warn('Failed to download specific photo size', e);
                  }
                }
              }

              // 3. Fallback: try generic thumb
              if (!buffer) {
                try {
                  buffer = await client.downloadMedia(media, { thumb: 0, workers: 8 } as any);
                } catch (e) {
                  console.warn(`Generic thumb download failed for ${messageId}`, e);
                }
              }

              if (buffer && isMounted) {
                const blob = new Blob([buffer]);
                const newUrl = URL.createObjectURL(blob);
                currentBlobUrl = newUrl;
                setUrl(newUrl);
                setLoading(false);
              } else if (isMounted) {
                setError(true);
                setLoading(false);
              }
            } else if (type === 'video' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
              // IMPLEMENT STREAMING FOR VIDEOS VIA SERVICE WORKER
              setStreaming(true);
              setLoading(false);
              
              const streamUrl = `/stream-media/${fileId}-${messageId}.mp4`;
              let totalSize = 0;
              if ((media as any).document?.size) {
                const sizeObj = (media as any).document.size;
                totalSize = typeof sizeObj === 'number' ? sizeObj : (sizeObj.toJSNumber ? sizeObj.toJSNumber() : Number(sizeObj));
              }
              const mimeType = (media as any).document?.mimeType || 'video/mp4';
              
              const messageChannel = new MessageChannel();
              
              messageChannel.port1.onmessage = async (event) => {
                if (event.data.type === 'REQUEST_STREAM') {
                  let cancelled = false;
                  let pullResolver: (() => void) | null = null;
                  let pullRequested = 1; // Start with 1 to allow the first chunk immediately
                  
                  event.data.port.onmessage = (e: any) => {
                    if (e.data.type === 'CANCEL') {
                      cancelled = true;
                      if (pullResolver) pullResolver();
                    } else if (e.data.type === 'PULL') {
                      pullRequested++;
                      if (pullResolver) {
                        pullResolver();
                        pullResolver = null;
                      }
                    }
                  };

                  try {
                    const range = event.data.range;
                    let start = 0;
                    let end = totalSize - 1;
                    let isRange = false;
                    
                    if (range) {
                      isRange = true;
                      const parts = range.replace(/bytes=/, "").split("-");
                      start = parseInt(parts[0], 10);
                      end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
                    }
                    
                    console.log(`[Streaming] Request range: ${range} -> start: ${start}, end: ${end}`);
                    
                    const contentLength = end - start + 1;
                    
                    event.data.port.postMessage({
                      type: 'HEADERS',
                      start,
                      end,
                      total: totalSize,
                      contentLength,
                      contentType: mimeType,
                      isRange
                    });

                    // Telegram API requires offset to be a multiple of 4096
                    const alignSize = 4096;
                    const alignedStart = Math.floor(start / alignSize) * alignSize;
                    const skipBytes = start - alignedStart;

                    const info = utils.getFileInfo(media as any);
                    const fileLocation = info.location;
                    const dcId = info.dcId;
                    
                    const chunkSize = 512 * 1024; // 512KB chunks
                    const headerPrefetchSize = 512 * 1024; // 512KB for header (Immediate delivery)
                    
                    // Concurrency adjustment: 4 workers for start of large files, 8 for the rest
                    let concurrentRequests = totalSize > 50 * 1024 * 1024 ? 4 : 8;
                    
                    let currentOffset = alignedStart;
                    let downloaded = 0;
                    let isFirstChunk = true;
                    
                    const fetchChunk = async (offset: number, customLimit?: number) => {
                      let retries = 0;
                      const maxRetries = 5; // Increased retries for stability
                      while (true) {
                        if (cancelled || cancelledRef.current) throw new Error('Cancelled');
                        try {
                          const sender = await client.getSender(dcId);
                          const request = new Api.upload.GetFile({
                            location: fileLocation,
                            offset: bigInt(offset),
                            limit: customLimit || chunkSize,
                          });
                          const result = await client.invokeWithSender(request, sender) as Api.upload.File;
                          
                          // If we successfully fetched a chunk, we can increase concurrency for the rest of the file
                          if (downloaded > 1024 * 1024) {
                            concurrentRequests = 8;
                          }
                          
                          return { offset, bytes: result.bytes };
                        } catch (err: any) {
                          if (err.errorMessage === 'FLOOD_WAIT') {
                            await new Promise(r => setTimeout(r, err.seconds * 1000));
                            continue;
                          }
                          
                          // Handle connection drops or other errors with retries
                          retries++;
                          console.warn(`[Streaming] Error fetching chunk at ${offset} (attempt ${retries}):`, err);
                          
                          if (retries >= maxRetries || cancelled || cancelledRef.current) {
                            throw err;
                          }
                          
                          // Exponential backoff
                          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, retries), 10000)));
                        }
                      }
                    };
                    
                    // Pre-fetch header if starting from 0
                    if (start === 0 && totalSize > headerPrefetchSize) {
                      console.log('[Streaming] Pre-fetching header (256KB)...');
                      const header = await fetchChunk(0, headerPrefetchSize);
                      const headerBuffer = new Uint8Array(header.bytes).buffer;
                      event.data.port.postMessage({
                        type: 'CHUNK',
                        chunk: headerBuffer
                      }, [headerBuffer]);
                      downloaded += header.bytes.length;
                      currentOffset = header.bytes.length;
                      isFirstChunk = false; // Already handled first chunk
                    }
                    
                    const prefetchQueue: Promise<{ offset: number, bytes: Buffer }>[] = [];
                    
                    const fillQueue = () => {
                      while (prefetchQueue.length < concurrentRequests && !cancelled && !cancelledRef.current && currentOffset < start + contentLength) {
                        prefetchQueue.push(fetchChunk(currentOffset));
                        currentOffset += chunkSize;
                      }
                    };
                    
                    fillQueue();
                    
                    while (!cancelled && !cancelledRef.current) {
                      const nextPromise = prefetchQueue.shift();
                      if (!nextPromise) break;
                      
                      fillQueue(); 
                      
                      const result = await nextPromise;
                      let chunkToSend = result.bytes;
                      
                      if (chunkToSend.length === 0) break; // EOF

                      if (isFirstChunk && skipBytes > 0) {
                        chunkToSend = chunkToSend.slice(skipBytes);
                        isFirstChunk = false;
                      }
                      
                      const remaining = contentLength - downloaded;
                      if (chunkToSend.length > remaining) {
                        chunkToSend = chunkToSend.slice(0, remaining);
                      }
                      
                      const chunkCopy = new Uint8Array(chunkToSend).buffer;
                      
                      event.data.port.postMessage({
                        type: 'CHUNK',
                        chunk: chunkCopy
                      }, [chunkCopy]);
                      
                      downloaded += chunkToSend.length;
                      if (downloaded >= contentLength) break;
                      
                      pullRequested--;
                      if (pullRequested <= 0) {
                        await new Promise<void>((resolve) => {
                          pullResolver = resolve;
                        });
                      }
                    }
                    
                    if (!cancelled && !cancelledRef.current) {
                      event.data.port.postMessage({ type: 'DONE' });
                    }
                  } catch (err) {
                    console.error('Error fetching chunk:', err);
                    event.data.port.postMessage({ type: 'ERROR', headersSent: true });
                  }
                }
              };
              
              navigator.serviceWorker.controller.postMessage({
                type: 'REGISTER_STREAM',
                url: streamUrl,
                port: messageChannel.port2
              }, [messageChannel.port2]);
              
              currentBlobUrl = streamUrl;
              setUrl(streamUrl);
            } else {
              // Full media download for photos or if streaming not supported
              const buffer = await client.downloadMedia(media, { workers: 8 } as any);
              if (buffer && isMounted) {
                const blob = new Blob([buffer]);
                const newUrl = URL.createObjectURL(blob);
                currentBlobUrl = newUrl;
                setUrl(newUrl);
                setLoading(false);
              } else if (isMounted) {
                setError(true);
                setLoading(false);
              }
            }
          } else {
            console.warn(`No media found for message ${messageId}`);
            if (isMounted) {
              setError(true);
              setLoading(false);
            }
          }
        } catch (err) {
          console.error('Error fetching large media:', err);
          if (isMounted) {
            setError(true);
            setLoading(false);
          }
        }
        return;
      }

      if (!botToken || !fileId) return;
      if (isLarge) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const response = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const filePath = response.data.result.file_path;
        if (isMounted) {
          setUrl(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error fetching Telegram file URL:', err);
        if (isMounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchUrl();
    return () => { 
      isMounted = false; 
      cancelledRef.current = true;
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
        try {
          mediaSourceRef.current.endOfStream();
        } catch (e) {}
      }
    };
  }, [fileId, botToken, isLarge, sessionString, chatId, messageId, apiId, apiHash]);

  if (isLarge && !url && loading) {
    return (
      <div className={cn("w-full h-full flex flex-col items-center justify-center bg-slate-800/50 text-slate-500 text-xs text-center p-4", className)}>
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-400" />
        <p className="font-bold text-indigo-400">Cargando Modo Pro...</p>
        <p className="opacity-60">{name}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("w-full h-full flex items-center justify-center bg-slate-800/50", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
      </div>
    );
  }

  if (error || (!url && !loading)) {
    return (
      <div className={cn("w-full h-full flex flex-col items-center justify-center bg-slate-800/50 text-slate-500 text-xs text-center p-2", className)}>
        {type === 'video' ? <Film className="w-8 h-8 mb-1 opacity-40" /> : <ImageIcon className="w-8 h-8 mb-1 opacity-40" />}
        <p className="opacity-60">Sin vista previa</p>
        {isLarge && <p className="text-[10px] text-indigo-400/50 mt-1">Modo Pro</p>}
      </div>
    );
  }

  if (type === 'photo' || (isThumbnail && url && !url.startsWith('http') && !url.includes('.mp4'))) {
    const filter = activeEdits ? `brightness(${activeEdits.brightness}%) contrast(${activeEdits.contrast}%) grayscale(${activeEdits.grayscale}%) sepia(${activeEdits.sepiaValue + (activeEdits.warmth || 0)}%) blur(${activeEdits.blur}px) hue-rotate(${activeEdits.hueRotate}deg) invert(${activeEdits.invert}%) saturate(${activeEdits.saturate}%)` : '';
    const transform = activeEdits ? `rotate(${activeEdits.rotation}deg) scaleX(${activeEdits.flipX ? -1 : 1})` : '';

    return (
      <div className={cn("relative w-full h-full", className)} style={style}>
        <img
          src={url}
          alt={name}
          onLoad={onLoad}
          style={{
            ...style,
            filter: style?.filter || filter,
            transform: style?.transform || transform,
          }}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        {isThumbnail && type === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-black/40 backdrop-blur-md rounded-full p-3 border border-white/20 shadow-2xl">
              <Play className="w-8 h-8 text-white fill-white" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative w-full h-full", className)} style={style}>
      {isThumbnail && type === 'video' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-black/40 backdrop-blur-md rounded-full p-3 border border-white/20 shadow-2xl">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
        </div>
      )}
      {streaming && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-indigo-600/80 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
          <Loader2 className="w-3 h-3 animate-spin" />
          Streaming
        </div>
      )}
      {!isThumbnail && !isReady && streaming && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-md transition-opacity duration-500">
          <div className="relative w-24 h-24 mb-6">
            {/* Circular Spinner */}
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                stroke="currentColor"
                strokeWidth="6"
                fill="transparent"
                className="text-slate-700"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                stroke="currentColor"
                strokeWidth="6"
                fill="transparent"
                strokeDasharray={251.2}
                strokeDashoffset={251.2 - (251.2 * Math.min(bufferingProgress, 100)) / 100}
                strokeLinecap="round"
                className="text-indigo-500 transition-all duration-500 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white font-mono">
              {Math.round(bufferingProgress)}%
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-white font-semibold text-lg animate-pulse">Optimizando Streaming...</p>
            <p className="text-indigo-300/80 text-sm font-medium">
              {downloadedBytes > 1024 * 1024 
                ? `${(downloadedBytes / (1024 * 1024)).toFixed(1)}MB descargados`
                : `${(downloadedBytes / 1024).toFixed(0)}KB descargados`}
            </p>
            <p className="text-slate-400 text-xs max-w-[200px] mx-auto leading-relaxed">
              Preparando buffer de seguridad para reproducción sin cortes
            </p>
          </div>
          
          {/* Progress Bar Bottom */}
          <div className="absolute bottom-12 w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5">
            <div 
              className="h-full bg-gradient-to-r from-indigo-600 to-violet-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(79,70,229,0.5)]"
              style={{ width: `${bufferingProgress}%` }}
            ></div>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        src={url}
        poster={thumbnailUrl}
        className="w-full h-full object-cover"
        style={{ display: (!isThumbnail && streaming && !isReady) ? 'none' : 'block' }}
        muted
        playsInline
        preload="auto"
        autoPlay={!isThumbnail && (isReady || !streaming)}
        loop={!isThumbnail}
        controls={!isThumbnail}
        onLoadedData={(e) => {
          if (isThumbnail) {
            e.currentTarget.currentTime = 0.1;
          }
        }}
        onMouseOver={(e) => isThumbnail && e.currentTarget.play()}
        onMouseOut={(e) => {
          if (isThumbnail) {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0.1;
          }
        }}
      />
    </div>
  );
};
