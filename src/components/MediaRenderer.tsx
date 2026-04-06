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
  const [isReadyToPlay, setIsReadyToPlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Conectando con Telegram...');
  const videoRef = useRef<HTMLVideoElement>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (streaming && !isReadyToPlay) {
      // Timeout for 0% progress
      connectionTimeoutRef.current = setTimeout(() => {
        if (bufferingProgress === 0) {
          console.warn('Connection stalled at 0%, re-initializing...');
          setLoadingMessage('Reintentando conexión...');
          // Trigger a re-fetch or re-init here if needed
        }
      }, 7000);
    }
    return () => {
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
    };
  }, [streaming, isReadyToPlay, bufferingProgress]);

  useEffect(() => {
    if (bufferingProgress < 10) setLoadingMessage('Conectando con Telegram...');
    else if (bufferingProgress < 25) setLoadingMessage('Descargando buffer de seguridad...');
    else setLoadingMessage('Casi listo...');
  }, [bufferingProgress]);
  const mediaSourceRef = useRef<MediaSource | null>(null);

  const activeEdits = overrideEdits || edits;

  useEffect(() => {
    let isMounted = true;
    let currentBlobUrl: string | null = null;

    const fetchUrl = async () => {
      if (isLarge && sessionString && chatId && messageId && apiId && apiHash) {
        setLoading(true);
        try {
          const client = await getTelegramClient(sessionString, apiId, apiHash);
          
          const peer = chatId.match(/^-?\d+$/) ? BigInt(chatId) : chatId;
          const messages = await client.getMessages(peer, { ids: [messageId] });
          
          if (messages && messages.length > 0 && messages[0].media) {
            const media = messages[0].media;
            
            console.log('Media found for message', messageId, ':', media);

            if (isThumbnail) {
              let buffer: any = null;
              // 1. Try to find thumbs in document
              if ((media as any).document && (media as any).document.thumbs) {
                const thumbs = (media as any).document.thumbs;
                if (thumbs && thumbs.length > 0) {
                  const thumbToDownload = thumbs[thumbs.length - 1];
                  try {
                    buffer = await client.downloadMedia(media, { thumb: thumbToDownload });
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
                    buffer = await client.downloadMedia(media, { thumb: thumbToDownload });
                  } catch (e) {
                    console.warn('Failed to download specific photo size', e);
                  }
                }
              }

              // 3. Fallback: try generic thumb
              if (!buffer) {
                try {
                  buffer = await client.downloadMedia(media, { thumb: 0 });
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
              
              const safeMessageId = String(messageId);
              const streamUrl = `/stream-media/${fileId}-${safeMessageId}.mp4`;
              let totalSize = 0;
              if ((media as any).document?.size) {
                const sizeObj = (media as any).document.size;
                if (typeof sizeObj === 'number') {
                  totalSize = sizeObj;
                } else if (typeof sizeObj === 'bigint') {
                  totalSize = Number(sizeObj);
                } else if (sizeObj && typeof sizeObj === 'object' && 'toJSNumber' in sizeObj) {
                  totalSize = sizeObj.toJSNumber();
                } else {
                  totalSize = Number(sizeObj);
                }
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
                    } else if (e.data.type === 'UPDATE_STRATEGY') {
                      // Handle strategy updates (e.g., increase workers)
                      console.log('Strategy update:', e.data.strategy);
                    }
                  };

                  // Force initial 1KB request
                  const initialRequest = new Api.upload.GetFile({
                    location: utils.getFileInfo(media as any).location,
                    offset: bigInt(0),
                    limit: 1024,
                  });
                  await client.invoke(initialRequest);
                  console.log('Initial 1KB request successful');

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
                    
                    const chunkSize = 1024 * 1024; // 1MB chunks for faster streaming
                    
                    // Pre-buffering logic: 15% of total size or 50MB (whichever is smaller)
                    const safeTotalSize = Number(totalSize);
                    const threshold = Math.min(safeTotalSize * 0.15, 50 * 1024 * 1024);
                    const minThreshold = Math.min(5 * 1024 * 1024, safeTotalSize);
                    const actualThreshold = Math.max(threshold, minThreshold);
                    
                    const isInitialRequest = start === 0;
                    let isPreBufferingActive = isInitialRequest;
                    
                    if (isPreBufferingActive) {
                      setIsPreBuffering(true);
                      setBufferingProgress(0);
                    }

                    const concurrentRequests = isPreBufferingActive ? 5 : 3; // Use more workers during pre-buffering
                    
                    let currentOffset = alignedStart;
                    let downloaded = 0;
                    let isFirstChunk = true;
                    
                    const prefetchQueue: Promise<{ offset: number, bytes: Buffer }>[] = [];
                    
                    const fetchChunk = async (offset: number) => {
                      let retries = 0;
                      while (true) {
                        try {
                          const sender = await client.getSender(dcId);
                          const request = new Api.upload.GetFile({
                            location: fileLocation,
                            offset: bigInt(offset),
                            limit: chunkSize,
                          });
                          const result = await client.invokeWithSender(request, sender) as Api.upload.File;
                          return { offset, bytes: result.bytes };
                        } catch (err: any) {
                          if (err.errorMessage === 'FLOOD_WAIT') {
                            await new Promise(r => setTimeout(r, err.seconds * 1000));
                            continue;
                          }
                          retries++;
                          if (retries >= 3) throw err;
                          await new Promise(r => setTimeout(r, 1000 * retries));
                        }
                      }
                    };
                    
                    const fillQueue = () => {
                      const currentConcurrency = isPreBufferingActive ? 5 : 3;
                      while (prefetchQueue.length < currentConcurrency && !cancelled && currentOffset < start + contentLength) {
                        prefetchQueue.push(fetchChunk(currentOffset));
                        currentOffset += chunkSize;
                      }
                    };
                    
                    fillQueue();
                    
                    const preBufferedChunks: Buffer[] = [];
                    let preBufferedSize = 0;

                    while (!cancelled) {
                      const nextPromise = prefetchQueue.shift();
                      if (!nextPromise) break;
                      
                      fillQueue(); // Keep queue full
                      
                      const result = await nextPromise;
                      let chunkToSend = result.bytes;
                      
                      if (chunkToSend.length === 0) break; // EOF

                      if (isPreBufferingActive) {
                        preBufferedChunks.push(chunkToSend);
                        preBufferedSize += chunkToSend.length;
                        
                        const progress = Math.min((preBufferedSize / actualThreshold) * 100, 100);
                        setBufferingProgress(progress);
                        
                        if (preBufferedSize >= actualThreshold) {
                          isPreBufferingActive = false;
                          setIsPreBuffering(false);
                          
                          // Release all pre-buffered chunks
                          for (const bufferedChunk of preBufferedChunks) {
                            let toSend = bufferedChunk;
                            if (isFirstChunk && skipBytes > 0) {
                              toSend = toSend.slice(skipBytes);
                              isFirstChunk = false;
                            }
                            
                            const remaining = contentLength - downloaded;
                            if (toSend.length > remaining) {
                              toSend = toSend.slice(0, remaining);
                            }
                            
                            const chunkCopy = new Uint8Array(toSend).buffer;
                            event.data.port.postMessage({
                              type: 'CHUNK',
                              chunk: chunkCopy
                            }, [chunkCopy]);
                            
                            downloaded += toSend.length;
                            pullRequested--;
                          }
                          preBufferedChunks.length = 0; // Clear memory
                        }
                        continue; // Keep buffering
                      }
                      
                      if (isFirstChunk && skipBytes > 0) {
                        chunkToSend = chunkToSend.slice(skipBytes);
                        isFirstChunk = false;
                      }
                      
                      const remaining = contentLength - downloaded;
                      if (chunkToSend.length > remaining) {
                        chunkToSend = chunkToSend.slice(0, remaining);
                      }
                      
                      // We need to copy the buffer because it might be transferred
                      const chunkCopy = new Uint8Array(chunkToSend).buffer;
                      
                      event.data.port.postMessage({
                        type: 'CHUNK',
                        chunk: chunkCopy
                      }, [chunkCopy]);
                      
                      downloaded += chunkToSend.length;
                      if (downloaded >= contentLength) break;
                      
                      pullRequested--;
                      if (pullRequested <= 0) {
                        // Wait for PULL request from service worker to avoid buffering too much in memory
                        await new Promise<void>((resolve) => {
                          pullResolver = resolve;
                        });
                      }
                    }
                    
                    if (!cancelled) {
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
              const buffer = await client.downloadMedia(media);
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
      if (currentBlobUrl) {
        // Notify Service Worker to cancel streaming
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'CANCEL_STREAM',
            url: currentBlobUrl
          });
        }
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
      {streaming && !isReadyToPlay && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center">
          {/* Blur background with thumbnail */}
          <div 
            className="absolute inset-0 bg-cover bg-center blur-xl"
            style={{ backgroundImage: `url(${url})` }}
          />
          <div className="absolute inset-0 bg-black/60" />
          
          {/* Circular Progress */}
          <div className="relative w-32 h-32 mb-6">
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle className="text-slate-700" strokeWidth="8" stroke="currentColor" fill="transparent" r="40" cx="50" cy="50" />
              <circle 
                className="text-indigo-500 transition-all duration-300" 
                strokeWidth="8" 
                strokeDasharray={251.2} 
                strokeDashoffset={251.2 - (bufferingProgress / 100) * 251.2} 
                strokeLinecap="round" 
                stroke="currentColor" 
                fill="transparent" 
                r="40" 
                cx="50" 
                cy="50" 
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-white text-xl font-bold">
              {Math.round(bufferingProgress)}%
            </div>
          </div>
          
          <p className="text-white font-medium text-lg animate-pulse">{loadingMessage}</p>
        </div>
      )}
      <video
        ref={videoRef}
        src={url}
        className={cn("w-full h-full object-cover transition-opacity duration-500", (!isReadyToPlay && !isThumbnail) ? "opacity-0" : "opacity-100")}
        muted
        playsInline
        preload="auto"
        autoPlay={isReadyToPlay && !isThumbnail}
        loop={!isThumbnail}
        controls={!isThumbnail}
        onLoadedData={(e) => {
          if (isThumbnail) {
            e.currentTarget.currentTime = 0.1;
          }
        }}
        onTimeUpdate={(e) => {
          if (!isThumbnail) {
            const video = e.currentTarget;
            const buffered = video.buffered;
            let bufferEnd = 0;
            for (let i = 0; i < buffered.length; i++) {
              if (video.currentTime >= buffered.start(i) && video.currentTime <= buffered.end(i)) {
                bufferEnd = buffered.end(i);
                break;
              }
            }
            const bufferRemaining = bufferEnd - video.currentTime;
            
            // Check for 40% buffer
            if (!isReadyToPlay && bufferingProgress >= 40) {
              setIsReadyToPlay(true);
              video.play();
            }

            // Silent Recovery Strategy & Catch-up Prevention
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'UPDATE_STREAM_STRATEGY',
                url: url,
                bufferRemaining: bufferRemaining,
                isLowBuffer: bufferRemaining < 5 && bufferEnd < video.duration,
                isReadyToPlay: isReadyToPlay
              });
            }
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
