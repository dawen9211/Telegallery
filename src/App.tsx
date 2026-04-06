import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Image as ImageIcon, 
  Film, 
  Loader2, 
  Trash2, 
  ExternalLink, 
  AlertCircle, 
  Settings, 
  X, 
  Check, 
  Download, 
  Maximize2, 
  FolderSync, 
  Filter, 
  SortAsc, 
  Plus,
  Copy,
  Search,
  CheckSquare,
  Square,
  Move,
  RotateCw,
  Sun,
  Contrast,
  Palette,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Zap,
  EyeOff,
  Crop,
  Wand2,
  Focus,
  Pencil,
  Highlighter,
  Type as TypeIcon,
  Thermometer,
  Cloud,
  Hand,
  Sparkles,
  Layers,
  History,
  Columns2,
  FlipHorizontal,
  Lock,
  Unlock,
  PenTool
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Cropper from 'react-easy-crop';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  serverTimestamp, 
  orderBy 
} from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { MediaRenderer } from './components/MediaRenderer';
import { Buffer } from 'buffer';
import { get, set } from 'idb-keyval';

// Utility for tailwind classes
import { getTelegramClient, disconnectTelegramClient, uploadLargeFile, downloadFile } from './lib/telegramClient';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MediaEdits {
  rotation: number;
  brightness: number;
  contrast: number;
  grayscale: number;
  blur: number;
  hueRotate: number;
  invert: number;
  saturate: number;
  sepiaValue: number;
  warmth: number;
  vignette: number;
  flipX: boolean;
  pan?: { x: number; y: number };
  zoom?: number;
  cropRatio?: string;
}

interface MediaItem {
  id: string; // Changed to string for Firestore ID
  fileId: string;
  messageId?: number;
  type: 'photo' | 'video';
  name: string;
  timestamp: string;
  album: string;
  isPrivate?: boolean;
  edits?: MediaEdits;
  uid: string;
  chatId: string;
  isLarge?: boolean;
}

type SortOption = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'type';

const formatSize = (bytes: number) => {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return size + ' ' + (sizes[i] || 'B');
};

// Helper to generate video thumbnail
const generateVideoThumbnail = (file: File): Promise<Blob | null> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    
    const url = URL.createObjectURL(file);
    video.src = url;
    
    video.onloadedmetadata = () => {
      // Seek to 1 second or half duration if shorter
      video.currentTime = Math.min(1, video.duration / 2);
    };
    
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, 'image/jpeg', 0.7);
      } else {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
};

// Helper to get video metadata
const getVideoMetadata = (file: File): Promise<{ width: number, height: number, duration: number } | null> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.src = url;
    video.onloadedmetadata = () => {
      const metadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Math.floor(video.duration)
      };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const cached = localStorage.getItem('tg_user');
    return cached ? JSON.parse(cached) : null;
  });
  const [authLoading, setAuthLoading] = useState(!localStorage.getItem('tg_user'));
  const [media, setMedia] = useState<MediaItem[]>(() => {
    const cached = localStorage.getItem('tg_media_cache');
    return cached ? JSON.parse(cached) : [];
  });
  const [loading, setLoading] = useState(!localStorage.getItem('tg_media_cache'));
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number, 
    total: number, 
    type?: 'upload' | 'zip' | 'download', 
    percent?: number,
    currentFileName?: string,
    currentSize?: number,
    totalSize?: number,
    totalFilesSize?: number
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [downloadDirHandle, setDownloadDirHandle] = useState<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    const loadDownloadDir = async () => {
      try {
        const handle = await get('download_dir_handle');
        if (handle) {
          // Verify permission
          const options = { mode: 'readwrite' };
          const permission = await handle.queryPermission(options);
          if (permission === 'granted') {
            setDownloadDirHandle(handle);
          }
        }
      } catch (e) {
        console.warn('Could not load download directory handle:', e);
      }
    };
    loadDownloadDir();
  }, []);

  const updateDownloadDirHandle = async (handle: FileSystemDirectoryHandle | null) => {
    setDownloadDirHandle(handle);
    try {
      await set('download_dir_handle', handle);
    } catch (e) {
      console.error('Error saving download directory handle:', e);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      if (showSettings) {
        setShowSettings(false);
      } else if (selectedMedia) {
        setSelectedMedia(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showSettings, selectedMedia]);

  useEffect(() => {
    if (showSettings) {
      window.history.pushState({ modal: 'settings' }, '');
    } else if (selectedMedia) {
      window.history.pushState({ modal: 'media' }, '');
    } else if (window.history.state?.modal) {
      window.history.back();
    }
  }, [showSettings, selectedMedia]);
  
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; id?: string; isBulk?: boolean }>({ isOpen: false });
  
  // Selection Mode
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // Editor State
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [grayscale, setGrayscale] = useState(0);
  const [sepia, setSepia] = useState(0);
  const [blur, setBlur] = useState(0);
  const [hueRotate, setHueRotate] = useState(0);
  const [invert, setInvert] = useState(0);
  const [saturate, setSaturate] = useState(100);
  const [sepiaValue, setSepiaValue] = useState(0);
  const [flipX, setFlipX] = useState(false);
  
  // UI Mode
  const [isEditing, setIsEditing] = useState(false);
  const [activeEditTab, setActiveEditTab] = useState<'suggestions' | 'crop' | 'adjust' | 'filters' | 'markup'>('crop');
  
  const [warmth, setWarmth] = useState(0);
  const [vignette, setVignette] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  
  // Telegram Settings
  const [botToken, setBotToken] = useState(() => localStorage.getItem('tg_bot_token') || '');
  const [chatId, setChatId] = useState(() => localStorage.getItem('tg_chat_id') || '');
  const [savedChatIds, setSavedChatIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('tg_saved_chat_ids');
    return saved ? JSON.parse(saved) : [];
  });
  const [apiId, setApiId] = useState(() => localStorage.getItem('tg_api_id') || '');
  const [apiHash, setApiHash] = useState(() => localStorage.getItem('tg_api_hash') || '');
  const [sessionString, setSessionString] = useState(() => localStorage.getItem('tg_session') || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginStep, setLoginStep] = useState<'none' | 'phone' | 'code'>('none');

  const [activeAdjustTool, setActiveAdjustTool] = useState('brightness');
  const [cropRatio, setCropRatio] = useState('free');
  const [showBatchMoveMenu, setShowBatchMoveMenu] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(5);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tgClientRef = useRef<any>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  
  const [showAddToMenu, setShowAddToMenu] = useState(false);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [showAlbumSelector, setShowAlbumSelector] = useState(false);
  const [albumSelectorMode, setAlbumSelectorMode] = useState<'move' | 'copy'>('move');
  const [customAlbums, setCustomAlbums] = useState<string[]>(() => {
    const saved = localStorage.getItem('tg_custom_albums');
    return saved ? JSON.parse(saved) : [];
  });
  
  // Private Folder State
  const [isPrivateMode, setIsPrivateMode] = useState(() => localStorage.getItem('tg_is_private') === 'true');
  const [privatePassword, setPrivatePassword] = useState(() => localStorage.getItem('tg_private_pass') || '');
  const [isPrivateLocked, setIsPrivateLocked] = useState(() => !sessionStorage.getItem('tg_private_unlocked'));
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [isConfirmingPassword, setIsConfirmingPassword] = useState(false);
  
  // Albums & Sorting
  const [activeAlbum, setActiveAlbum] = useState(() => localStorage.getItem('tg_active_album') || 'Todos');
  const [sortBy, setSortBy] = useState<SortOption>(() => (localStorage.getItem('tg_sort_by') as SortOption) || 'date-desc');
  const [uploadAlbum, setUploadAlbum] = useState('General');
  
  // Persist state
  useEffect(() => {
    localStorage.setItem('tg_active_album', activeAlbum);
  }, [activeAlbum]);

  useEffect(() => {
    localStorage.setItem('tg_is_private', isPrivateMode.toString());
  }, [isPrivateMode]);

  useEffect(() => {
    localStorage.setItem('tg_sort_by', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('tg_api_id', apiId);
    localStorage.setItem('tg_api_hash', apiHash);
    localStorage.setItem('tg_session', sessionString);
  }, [apiId, apiHash, sessionString]);
  
  // Telegram Login Logic
  const startLogin = async () => {
    if (!apiId || !apiHash || !phoneNumber) return setError('Faltan datos (API ID, Hash o Teléfono)');
    setIsLoggingIn(true);
    setError(null);
    try {
      // Test Buffer before anything else
      try {
        console.log('Buffer check:', typeof Buffer, typeof Buffer?.prototype?.slice, typeof Buffer?.from);
        const testBuf = Buffer.from('test');
        if (!testBuf || typeof testBuf.slice !== 'function') {
          throw new Error('Buffer.slice is not a function');
        }
        console.log('Buffer test passed');
      } catch (e) {
        console.error('Buffer test failed:', e);
        throw new Error('Error de compatibilidad: El navegador no soporta las funciones necesarias (Buffer).');
      }

      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');
      
      const apiIdNum = Number(apiId.trim());
      const apiHashStr = apiHash.trim();
      const phoneStr = phoneNumber.trim();
      
      if (isNaN(apiIdNum)) throw new Error('API ID debe ser un número');
      
      console.log('Initializing Telegram client with API ID:', apiIdNum);
      const client = new TelegramClient(new StringSession(""), apiIdNum, apiHashStr, { 
        connectionRetries: 5,
        useWSS: true
      });
      tgClientRef.current = client;
      
      // Explicitly set these to ensure they are available for sendCode
      (client as any).apiId = apiIdNum;
      (client as any).apiHash = apiHashStr;
      
      console.log('Connecting to Telegram...');
      await client.connect();
      console.log('Connected to Telegram');
      
      let result;
      try {
        console.log('Sending code (attempt 1)...');
        // Try standard signature
        result = await client.sendCode({ 
          apiId: apiIdNum, 
          apiHash: apiHashStr
        }, phoneStr);
      } catch (e: any) {
        console.warn('First sendCode attempt failed, trying alternative signature:', e);
        // Try single object signature as fallback
        result = await client.sendCode({ 
          apiId: apiIdNum, 
          apiHash: apiHashStr,
          phoneNumber: phoneStr
        } as any, phoneStr);
      }
      
      if (!result || !result.phoneCodeHash) {
        console.error('No result from sendCode:', result);
        throw new Error('No se recibió el hash de confirmación. Revisa tus credenciales.');
      }
      
      console.log('Code sent successfully, hash:', result.phoneCodeHash);
      setPhoneCodeHash(result.phoneCodeHash);
      setLoginStep('code');
      setSuccessMessage('Código enviado a tu Telegram');
    } catch (err: any) {
      tgClientRef.current = null;
      console.error('Error in startLogin:', err);
      const msg = err.message || 'Error desconocido';
      const stack = err.stack ? ` (${err.stack.split('\n')[0]})` : '';
      setError('Error al enviar código: ' + msg + stack);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const completeLogin = async () => {
    if (!phoneCode) return setError('Introduce el código');
    if (!phoneCodeHash) return setError('Hash de confirmación perdido. Por favor, vuelve a enviar el código.');
    setIsLoggingIn(true);
    try {
      const { Api } = await import('telegram');
      
      let client = tgClientRef.current;
      
      if (!client) {
        // Fallback if client was lost (should not happen if same component)
        const { TelegramClient } = await import('telegram');
        const { StringSession } = await import('telegram/sessions');
        client = new TelegramClient(new StringSession(""), parseInt(apiId), apiHash, { 
          connectionRetries: 5,
          useWSS: true
        });
        await client.connect();
      }

      console.log('Verifying code with hash:', phoneCodeHash);
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: phoneNumber,
        phoneCodeHash: phoneCodeHash,
        phoneCode: phoneCode.trim(),
      }));
      
      const session = client.session.save() as unknown as string;
      setSessionString(session);
      setLoginStep('none');
      tgClientRef.current = null;
      setSuccessMessage('¡Cuenta conectada con éxito!');
    } catch (err: any) {
      console.error('Error in completeLogin:', err);
      if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
        setError('Tu cuenta tiene Verificación en Dos Pasos (2FA). Por favor, desactívala temporalmente para conectar.');
      } else if (err.message.includes('PHONE_CODE_EXPIRED')) {
        setError('El código ha expirado. Por favor, vuelve a enviarlo.');
      } else if (err.message.includes('PHONE_CODE_INVALID')) {
        setError('El código introducido no es válido.');
      } else {
        setError('Error al verificar código: ' + err.message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };
  
  const isInitialLoad = useRef(true);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        localStorage.setItem('tg_user', JSON.stringify(u));
      } else {
        localStorage.removeItem('tg_user');
      }
      setAuthLoading(false);
    });
    return () => {
      unsubscribe();
      disconnectTelegramClient();
    };
  }, []);

  // Firestore Real-time Listener
  useEffect(() => {
    if (!user) {
      setMedia([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, 'media'),
      where('uid', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: MediaItem[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toDate().toISOString() : data.timestamp,
        } as MediaItem);
      });
      setMedia(items);
      localStorage.setItem('tg_media_cache', JSON.stringify(items));
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error('Firestore error:', err);
      setError('Error al conectar con la base de datos.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const getTelegramFileUrl = async (fileId: string) => {
    if (!botToken) {
      console.error('getTelegramFileUrl: botToken is missing');
      return '';
    }
    try {
      const response = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
      if (!response.data.ok) {
        throw new Error(response.data.description || 'Error desconocido de Telegram');
      }
      const filePath = response.data.result.file_path;
      return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    } catch (err) {
      console.error('Error getting Telegram file:', err);
      throw err;
    }
  };

  useEffect(() => {
    if (isEditing && selectedMedia) {
      resetEditor();
      if (selectedMedia.type === 'photo') {
        if (selectedMedia.isLarge) {
          ensureTgClient().then(async (client) => {
            if (!client) throw new Error('Conecta tu cuenta para editar archivos grandes');
            const peer = selectedMedia.chatId.match(/^-?\d+$/) ? BigInt(selectedMedia.chatId) : selectedMedia.chatId;
            const messages = await client.getMessages(peer, { ids: [selectedMedia.messageId] });
            if (!messages || messages.length === 0) throw new Error('No se encontró el mensaje');
            const buffer = await client.downloadMedia(messages[0].media);
            const blob = new Blob([buffer]);
            setEditingImageUrl(URL.createObjectURL(blob));
          }).catch(err => {
            console.error('Error loading large editing image:', err);
            setError('Error al cargar la imagen grande para editar');
          });
        } else {
          getTelegramFileUrl(selectedMedia.fileId).then(url => {
            setEditingImageUrl(url);
          }).catch(err => {
            console.error('Error loading editing image:', err);
            setError('Error al cargar la imagen para editar');
          });
        }
      }
    } else {
      setEditingImageUrl(null);
    }
  }, [isEditing]);

  // Save local metadata whenever media changes
  useEffect(() => {
    if (media.length > 0) {
      const metadataMap: Record<string, any> = {};
      media.forEach(m => {
        metadataMap[m.fileId] = {
          album: m.album,
          isPrivate: m.isPrivate,
          edits: m.edits
        };
      });
      localStorage.setItem('tg_media_metadata', JSON.stringify(metadataMap));
    }
  }, [media]);

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('tg_bot_token', botToken);
    localStorage.setItem('tg_chat_id', chatId);
    localStorage.setItem('tg_api_id', apiId);
    localStorage.setItem('tg_api_hash', apiHash);
    
    if (chatId && !savedChatIds.includes(chatId)) {
      const newSaved = [...savedChatIds, chatId];
      setSavedChatIds(newSaved);
      localStorage.setItem('tg_saved_chat_ids', JSON.stringify(newSaved));
    }
    
    setShowSettings(false);
  };

  const deleteMedia = async (id: string) => {
    setConfirmDelete({ isOpen: true, id, isBulk: false });
  };

  const confirmDeleteAction = async () => {
    const { id, isBulk } = confirmDelete;
    setConfirmDelete({ isOpen: false });
    
    setUploading(true);
    try {
      if (isBulk) {
        if (selectedIds.size === 0) return;
        for (const id of Array.from(selectedIds)) {
          const item = media.find(m => m.id === id);
          if (item && item.messageId && botToken) {
            try {
              await axios.post(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                chat_id: chatId,
                message_id: item.messageId
              });
            } catch (tgErr) {
              console.error('Failed to delete from Telegram:', tgErr);
            }
          }
          await deleteDoc(doc(db, 'media', id as string));
        }
        setSelectedIds(new Set());
        setIsSelectionMode(false);
      } else if (id !== undefined) {
        const item = media.find(m => m.id === id);
        if (item && item.messageId && botToken) {
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
              chat_id: chatId,
              message_id: item.messageId
            });
          } catch (tgErr) {
            console.error('Failed to delete from Telegram:', tgErr);
          }
        }
        await deleteDoc(doc(db, 'media', id as string));
        if (selectedIds.has(id as string)) {
          const newSelected = new Set(selectedIds);
          newSelected.delete(id as string);
          setSelectedIds(newSelected);
        }
        if (selectedMedia?.id === id) setSelectedMedia(null);
      }
    } catch (err) {
      setError('Error al eliminar el archivo');
    } finally {
      setUploading(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setConfirmDelete({ isOpen: true, isBulk: true });
  };

  const moveSelectedToAlbum = async (targetAlbum: string) => {
    if (selectedIds.size === 0 || !targetAlbum) return;
    
    setUploading(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await updateDoc(doc(db, 'media', id as string), { album: targetAlbum });
      }
      
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setSuccessMessage(`Movidos ${selectedIds.size} archivos a "${targetAlbum}"`);
    } catch (err) {
      setError('Error al mover archivos.');
    } finally {
      setUploading(false);
      setTimeout(() => setError(null), 2000);
    }
  };

  const moveSelectedToPrivate = async () => {
    if (selectedIds.size === 0) return;
    
    const isCurrentlyInPrivate = activeAlbum === 'Privado';

    if (!isCurrentlyInPrivate && !privatePassword) {
      setIsSettingPassword(true);
      setShowPasswordModal(true);
      return;
    }

    setUploading(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await updateDoc(doc(db, 'media', id as string), { isPrivate: !isCurrentlyInPrivate });
      }
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setSuccessMessage(isCurrentlyInPrivate ? `Movidos ${selectedIds.size} archivos a galería` : `Movidos ${selectedIds.size} archivos a carpeta privada`);
    } catch (err) {
      setError('Error al cambiar privacidad.');
    } finally {
      setUploading(false);
      setTimeout(() => setError(null), 2000);
    }
  };

  useEffect(() => {
    if (activeEditTab === 'markup' && canvasRef.current) {
      const canvas = canvasRef.current;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    }
  }, [activeEditTab, selectedMedia]);

  const resetEditor = (item?: MediaItem) => {
    const target = item || selectedMedia;
    if (target?.edits) {
      setRotation(target.edits.rotation);
      setBrightness(target.edits.brightness);
      setContrast(target.edits.contrast);
      setGrayscale(target.edits.grayscale);
      setBlur(target.edits.blur);
      setHueRotate(target.edits.hueRotate);
      setInvert(target.edits.invert);
      setSaturate(target.edits.saturate);
      setSepiaValue(target.edits.sepiaValue);
      setWarmth(target.edits.warmth);
      setVignette(target.edits.vignette);
      setFlipX(target.edits.flipX);
      setPan(target.edits.pan || { x: 0, y: 0 });
      setZoom(target.edits.zoom || 1);
      setCropRatio(target.edits.cropRatio || 'free');
    } else {
      setRotation(0);
      setBrightness(100);
      setContrast(100);
      setGrayscale(0);
      setBlur(0);
      setHueRotate(0);
      setInvert(0);
      setSaturate(100);
      setSepiaValue(0);
      setWarmth(0);
      setVignette(0);
      setFlipX(false);
      setPan({ x: 0, y: 0 });
      setZoom(1);
      setCropRatio('free');
    }
  };

  const resetToOriginal = () => {
    setRotation(0);
    setBrightness(100);
    setContrast(100);
    setGrayscale(0);
    setBlur(0);
    setHueRotate(0);
    setInvert(0);
    setSaturate(100);
    setSepiaValue(0);
    setWarmth(0);
    setVignette(0);
    setFlipX(false);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setCropRatio('free');
  };

  const navigateMedia = (direction: 'next' | 'prev') => {
    if (!selectedMedia) return;
    const currentIndex = filteredAndSortedMedia.findIndex(m => m.id === selectedMedia.id);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % filteredAndSortedMedia.length;
    } else {
      nextIndex = (currentIndex - 1 + filteredAndSortedMedia.length) % filteredAndSortedMedia.length;
    }

    setSelectedMedia(filteredAndSortedMedia[nextIndex]);
    resetEditor(filteredAndSortedMedia[nextIndex]);
  };

  const copyToClipboard = async (text: string) => {
    try {
      // Modern Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API failed, using fallback:', err);
    }

    // Fallback: Textarea method
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      return false;
    }
  };

  const downloadMedia = async (item: MediaItem) => {
    setUploading(true);
    setUploadProgress({ current: 0, total: 1, type: 'download' });
    try {
      let blob: Blob;
      
      if (item.isLarge) {
        const client = await ensureTgClient();
        if (!client) throw new Error('Conecta tu cuenta (Modo Pro) para descargar archivos grandes');
        
        console.log(`Downloading ${item.name} via GramJS...`);
        // GramJS downloadMedia needs a message or media object
        const peer = item.chatId.match(/^-?\d+$/) ? BigInt(item.chatId) : item.chatId;
        const messages = await client.getMessages(peer as any, { ids: [item.messageId] });
        if (!messages || messages.length === 0) throw new Error('No se encontró el mensaje en Telegram');
        
        const media = messages[0].media;
        const totalSize = (media as any).document?.size || (media as any).photo?.sizes?.slice(-1)[0]?.size || 0;

        const buffer = await downloadFile(client, media, {
          workers: 8,
          progressCallback: (progress: any) => {
            // GramJS progressCallback returns a fraction (0 to 1)
            const percent = Math.round(Number(progress) * 100);
            const currentBytes = Math.round(Number(progress) * Number(totalSize));
            console.log(`Download progress for ${item.name}: ${percent}%`);
            setUploadProgress({ 
              current: percent, 
              total: 100, 
              type: 'download',
              percent: percent,
              currentSize: currentBytes,
              totalSize: Number(totalSize)
            });
          }
        });
        blob = new Blob([buffer]);
      } else {
        const url = await getTelegramFileUrl(item.fileId);
        if (!url) throw new Error('No se pudo obtener el enlace de Telegram');
        
        const proxyUrl = `/api/proxy-telegram?url=${encodeURIComponent(url)}`;
        const response = await axios.get(proxyUrl, { responseType: 'blob' });
        blob = response.data;
      }
      
      const fileName = item.name || `archivo_${item.id}`;

      if (downloadDirHandle) {
        try {
          // Verify permission
          const options = { mode: 'readwrite' };
          if ((await downloadDirHandle.queryPermission(options as any)) !== 'granted') {
            if ((await downloadDirHandle.requestPermission(options as any)) !== 'granted') {
              throw new Error('Permiso denegado para la carpeta');
            }
          }
          const fileHandle = await downloadDirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (e) {
          console.warn('Error using directory handle, falling back to standard download:', e);
          const { saveAs } = await import('file-saver');
          saveAs(blob, fileName);
        }
      } else {
        const { saveAs } = await import('file-saver');
        saveAs(blob, fileName);
      }

      setUploadProgress({ current: 1, total: 1, type: 'download' });
      setSuccessMessage('¡Descarga completada!');
    } catch (err) {
      console.error('Error downloading:', err);
      setError(`Error al descargar: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  const downloadMultipleMedia = async (items: MediaItem[]) => {
    if (items.length === 0) return;
    setUploading(true);
    setSuccessMessage('Preparando archivos para descargar...');
    
    try {
      setUploadProgress({ current: 0, total: items.length, type: 'download' });
      
      const useHandle = !!downloadDirHandle;
      if (useHandle) {
        const options = { mode: 'readwrite' };
        if ((await downloadDirHandle!.queryPermission(options as any)) !== 'granted') {
          await downloadDirHandle!.requestPermission(options as any);
        }
      }

      const needsGramJS = items.some(item => item.isLarge);
      let client = null;
      if (needsGramJS) {
        try {
          client = await ensureTgClient();
        } catch (err) {
          console.error('Failed to initialize Telegram client for download:', err);
          setError('Error al conectar con Telegram para archivos grandes.');
        }
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (item.isLarge && client) {
          // Use GramJS for large files
          try {
            const peer = item.chatId.match(/^-?\d+$/) ? BigInt(item.chatId) : item.chatId;
            const messages = await client.getMessages(peer as any, { ids: [item.messageId] });
            
            if (messages && messages.length > 0 && messages[0].media) {
              const media = messages[0].media;
              const totalSize = (media as any).document?.size || (media as any).photo?.sizes?.slice(-1)[0]?.size || 0;
              
              const buffer = await downloadFile(client, media, {
                workers: 8,
                progressCallback: (progress: any) => {
                  // GramJS progressCallback returns a fraction (0 to 1)
                  const percent = Math.round(Number(progress) * 100);
                  const currentBytes = Math.round(Number(progress) * Number(totalSize));
                  setUploadProgress({ 
                    current: i + 1, 
                    total: items.length, 
                    type: 'download',
                    percent: percent,
                    currentSize: currentBytes,
                    totalSize: Number(totalSize)
                  });
                }
              });
              
              if (buffer) {
                const blob = new Blob([buffer]);
                const fileName = item.name || `archivo_${item.id}`;
                
                if (downloadDirHandle) {
                  const fileHandle = await downloadDirHandle.getFileHandle(fileName, { create: true });
                  const writable = await fileHandle.createWritable();
                  await writable.write(blob);
                  await writable.close();
                } else {
                  const { saveAs } = await import('file-saver');
                  saveAs(blob, fileName);
                }
              }
            }
          } catch (e) {
            console.error(`Error downloading large file ${item.id}:`, e);
          }
        } else {
          // Use Bot API for small files
          const url = await getTelegramFileUrl(item.fileId);
          if (url) {
            try {
              const proxyUrl = `/api/proxy-telegram?url=${encodeURIComponent(url)}`;
              const response = await axios.get(proxyUrl, { responseType: 'blob' });
              const fileName = item.name || `archivo_${item.id}`;

              if (downloadDirHandle) {
                const fileHandle = await downloadDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(response.data);
                await writable.close();
              } else {
                const { saveAs } = await import('file-saver');
                saveAs(response.data, fileName);
                if (items.length > 1) await new Promise(r => setTimeout(r, 500));
              }
            } catch (e) {
              console.warn(`Could not fetch blob for ${item.id}, skipping download for this item`, e);
            }
          }
        }
        setUploadProgress({ current: i + 1, total: items.length, type: 'download' });
      }
      
      setSuccessMessage('¡Descarga completada!');
    } catch (err) {
      console.error('Error downloading multiple:', err);
      setError(`Error al descargar: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  const downloadSelected = async () => {
    if (selectedIds.size === 0) return;
    const selectedMediaItems = media.filter(m => selectedIds.has(m.id));
    await downloadMultipleMedia(selectedMediaItems);
  };

  const downloadAlbum = async () => {
    const albumMedia = filteredAndSortedMedia;
    if (albumMedia.length === 0) return;
    await downloadMultipleMedia(albumMedia);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedMedia.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSortedMedia.map(m => m.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const ensureTgClient = async () => {
    if (!sessionString || !apiId || !apiHash) return null;
    return getTelegramClient(sessionString, apiId, apiHash);
  };

  const uploadFiles = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0 || !user) return;
    
    if (!botToken && !sessionString) {
      setError('Por favor configura Telegram o conecta tu cuenta en los ajustes.');
      setShowSettings(true);
      return;
    }

    setUploading(true);
    setError(null);
    const totalFilesSize = filesToUpload.reduce((acc, f) => acc + f.size, 0);
    setUploadProgress({ 
      current: 0, 
      total: filesToUpload.length, 
      type: 'upload',
      totalFilesSize
    });

    const needsGramJS = filesToUpload.some(f => f.size > 50 * 1024 * 1024) || !botToken;
    let client = null;
    
    if (needsGramJS && sessionString) {
      try {
        client = await ensureTgClient();
      } catch (err: any) {
        console.error('Failed to initialize Telegram client:', err);
        setError('Error al conectar con Telegram para archivos grandes. Revisa tu configuración.');
        setUploading(false);
        setUploadProgress(null);
        return;
      }
    }

    let current = 0;
    for (const file of filesToUpload) {
      current++;
      setUploadProgress(prev => prev ? { 
        ...prev,
        current,
        percent: 0,
        currentFileName: file.name,
        currentSize: 0,
        totalSize: file.size
      } : null);

      try {
        let fileId = '';
        let messageId = 0;
        const isVideo = file.type.startsWith('video/');
        const isLarge = file.size > 50 * 1024 * 1024;

        const useGramJS = !!(client && (isLarge || !botToken));

        if (useGramJS) {
          // Use GramJS (User API) for large files or if bot token is missing
          console.log(`Uploading ${file.name} via GramJS...`);
          
          const { Api } = await import('telegram');
          
          // Ensure chatId is BigInt if it's numeric
          const peer = chatId.match(/^-?\d+$/) ? BigInt(chatId) : chatId;
          
          // Use uploadFile first for better control over large files
          // In the browser, GramJS handles File/Blob objects directly in uploadFile
            const uploadedFile = await uploadLargeFile(
              client,
              file,
              (progress: number) => {
                 const percent = Math.round(progress * 100);
                 setUploadProgress({ 
                   current, 
                   total: filesToUpload.length, 
                   type: 'upload',
                   percent: percent,
                   currentFileName: file.name,
                   currentSize: Math.round(progress * file.size),
                   totalSize: file.size,
                   totalFilesSize
                 });
              }
            );

          let thumb = undefined;
          let attributes = [];
          
          if (isVideo) {
            const thumbBlob = await generateVideoThumbnail(file);
            if (thumbBlob) {
              thumb = new File([thumbBlob], 'thumb.jpg', { type: 'image/jpeg' });
            }
            
            const metadata = await getVideoMetadata(file);
            if (metadata) {
              attributes.push(new Api.DocumentAttributeVideo({
                w: metadata.width,
                h: metadata.height,
                duration: metadata.duration,
                supportsStreaming: true,
              }));
            }
          }

          const result = await client.sendFile(peer as any, {
            file: uploadedFile,
            caption: file.name,
            thumb: thumb,
            attributes: attributes,
          });
          
          messageId = result.id;
          fileId = result.id.toString(); 
        } else {
          // Use Bot API for small files
          const formData = new FormData();
          formData.append('chat_id', chatId);
          const fieldName = isVideo ? 'video' : 'photo';
          formData.append(fieldName, file);
          const endpoint = isVideo ? '/sendVideo' : '/sendPhoto';
          const response = await axios.post(`https://api.telegram.org/bot${botToken}${endpoint}`, formData, {
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setUploadProgress({
                  current,
                  total: filesToUpload.length,
                  type: 'upload',
                  percent: percent,
                  currentFileName: file.name,
                  currentSize: progressEvent.loaded,
                  totalSize: progressEvent.total,
                  totalFilesSize
                });
              }
            }
          });
          
          const result = response.data.result;
          messageId = result.message_id;
          if (isVideo) {
            fileId = result.video.file_id;
          } else {
            fileId = result.photo[result.photo.length - 1].file_id;
          }
        }

        await addDoc(collection(db, 'media'), {
          uid: user.uid,
          chatId,
          fileId,
          messageId,
          type: isVideo ? 'video' : 'photo',
          name: file.name,
          timestamp: serverTimestamp(),
          album: uploadAlbum,
          isPrivate: false,
          isLarge: useGramJS // Only flag as large if we used GramJS
        });

      } catch (err: any) {
        console.error('Upload failed:', err);
        setError(`Error al subir ${file.name}: ${err.message || 'Revisa tu configuración'}`);
        break;
      }
    }
    
    setUploading(false);
    setUploadProgress(null);
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    await uploadFiles(acceptedFiles);
  }, [botToken, chatId, user, uploadAlbum]);

  const folderInputRef = React.useRef<HTMLInputElement>(null);
  
  // Folder Sync Logic
  const syncFolder = () => {
    folderInputRef.current?.click();
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const mediaFiles = Array.from(files).filter((f: any) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    
    // Filter out already uploaded files by name
    const newFiles = mediaFiles.filter((file: any) => !media.some(m => m.name === file.name));
    
    if (newFiles.length > 0) {
      const skipped = mediaFiles.length - newFiles.length;
      if (skipped > 0) {
        setSuccessMessage(`Omitidos ${skipped} archivos que ya existían. Subiendo ${newFiles.length}...`);
      }
      await uploadFiles(newFiles as File[]);
      setSuccessMessage(`Sincronización finalizada. Se subieron ${newFiles.length} archivos nuevos.`);
    } else {
      setSuccessMessage('Sincronización finalizada. No se encontraron archivos nuevos.');
    }
    e.target.value = '';
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleSaveEdits = async () => {
    if (!selectedMedia) return;
    
    const edits: MediaEdits = {
      rotation,
      brightness,
      contrast,
      grayscale,
      blur,
      hueRotate,
      invert,
      saturate,
      sepiaValue,
      warmth,
      vignette,
      flipX,
      pan,
      zoom,
      cropRatio,
    };
    
    try {
      await updateDoc(doc(db, 'media', selectedMedia.id), { edits });
      setIsEditing(false);
      setSuccessMessage('Cambios guardados');
    } catch (err) {
      setError('Error al guardar cambios');
    }
    setTimeout(() => setError(null), 2000);
  };

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    
    const albumName = newAlbumName.trim();
    if (!customAlbums.includes(albumName)) {
      const updatedAlbums = [...customAlbums, albumName];
      setCustomAlbums(updatedAlbums);
      localStorage.setItem('tg_custom_albums', JSON.stringify(updatedAlbums));
    }
    
    if (selectedMedia) {
      try {
        await updateDoc(doc(db, 'media', selectedMedia.id), { album: albumName, isPrivate: false });
        setSuccessMessage(`Foto movida al nuevo álbum "${albumName}"`);
      } catch (err) {
        setError('Error al mover al álbum');
      }
    } else {
      setSuccessMessage(`Álbum "${albumName}" creado`);
    }
    
    setNewAlbumName('');
    setShowCreateAlbumModal(false);
    setTimeout(() => setError(null), 2000);
  };

  const handleMoveOrCopy = async (albumName: string, mode: 'move' | 'copy') => {
    if (!selectedMedia) return;
    
    try {
      if (mode === 'move') {
        await updateDoc(doc(db, 'media', selectedMedia.id), { album: albumName, isPrivate: false });
        setSuccessMessage(`Movido a ${albumName}`);
      } else {
        const { id, ...data } = selectedMedia;
        await addDoc(collection(db, 'media'), { ...data, album: albumName, isPrivate: false, timestamp: serverTimestamp() });
        setSuccessMessage(`Copiado a ${albumName}`);
      }
    } catch (err) {
      setError('Error al realizar la operación');
    }
    
    setShowAlbumSelector(false);
    setShowAddToMenu(false);
    setTimeout(() => setError(null), 2000);
  };

  const handleMoveToAlbum = async (albumName: string) => {
    if (!selectedMedia) return;
    
    try {
      await updateDoc(doc(db, 'media', selectedMedia.id), { album: albumName, isPrivate: false });
      setShowAlbumSelector(false);
      setShowAddToMenu(false);
      setError(`Movido a ${albumName}`);
    } catch (err) {
      setError('Error al mover');
    }
    setTimeout(() => setError(null), 2000);
  };

  const handleDeleteAlbum = (albumToDelete: string) => {
    if (albumToDelete === 'Todos' || albumToDelete === 'Privado' || albumToDelete === 'General') return;
    const updated = customAlbums.filter(a => a !== albumToDelete);
    setCustomAlbums(updated);
    localStorage.setItem('tg_custom_albums', JSON.stringify(updated));
    if (activeAlbum === albumToDelete) setActiveAlbum('Todos');
  };

  const handleTogglePrivate = async () => {
    if (!selectedMedia) return;
    
    if (!privatePassword) {
      setIsSettingPassword(true);
      setShowPasswordModal(true);
      return;
    }
    
    try {
      await updateDoc(doc(db, 'media', selectedMedia.id), { isPrivate: !selectedMedia.isPrivate });
      setShowAddToMenu(false);
      setSelectedMedia(null); // Close modal after moving
      setSuccessMessage(selectedMedia.isPrivate ? 'Movido a galería pública' : 'Movido a carpeta privada');
    } catch (err) {
      setError('Error al cambiar privacidad');
    }
    setTimeout(() => setError(null), 2000);
  };

  const handlePasswordSubmit = () => {
    if (isSettingPassword) {
      if (passwordInput.length < 4) {
        setError('La contraseña debe tener al menos 4 caracteres');
        return;
      }
      if (!isConfirmingPassword) {
        setIsConfirmingPassword(true);
        setConfirmPasswordInput(passwordInput);
        setPasswordInput('');
        setError('Confirma la contraseña');
        return;
      }
      if (passwordInput !== confirmPasswordInput) {
        setError('Las contraseñas no coinciden');
        setPasswordInput('');
        setIsConfirmingPassword(false);
        return;
      }
      
      setPrivatePassword(passwordInput);
      localStorage.setItem('tg_private_pass', passwordInput);
      sessionStorage.setItem('tg_private_unlocked', 'true');
      setIsPrivateLocked(false);
      setIsSettingPassword(false);
      setIsConfirmingPassword(false);
      setShowPasswordModal(false);
      setPasswordInput('');
      setConfirmPasswordInput('');
      
      if (selectedMedia) {
        setMedia(prev => prev.map(m => 
          m.id === selectedMedia.id ? { ...m, isPrivate: true } : m
        ));
        setSuccessMessage('Movido a carpeta privada');
      }
    } else {
      if (passwordInput === privatePassword) {
        setIsPrivateLocked(false);
        sessionStorage.setItem('tg_private_unlocked', 'true');
        setShowPasswordModal(false);
        setPasswordInput('');
      } else {
        setError('Contraseña incorrecta');
      }
    }
    setTimeout(() => setError(null), 2000);
  };

  const albums = useMemo(() => {
    const set = new Set(media.filter(m => !m.isPrivate).map(m => m.album || 'General'));
    customAlbums.forEach(a => set.add(a));
    const otherAlbums = Array.from(set).filter(a => a !== 'Todos');
    return ['Todos', ...otherAlbums, 'Privado'];
  }, [media, customAlbums]);

  const filteredAndSortedMedia = useMemo(() => {
    let result = [...media];
    
    if (activeAlbum === 'Privado') {
      if (isPrivateLocked) return [];
      result = result.filter(m => m.isPrivate);
    } else {
      result = result.filter(m => !m.isPrivate);
      if (activeAlbum !== 'Todos') {
        result = result.filter(m => m.album === activeAlbum);
      }
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc': return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        case 'date-asc': return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'type': return a.type.localeCompare(b.type);
        default: return 0;
      }
    });

    return result;
  }, [media, activeAlbum, sortBy]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif'],
      'video/*': ['.mp4', '.mov', '.avi'],
    },
    multiple: true,
  } as any);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-24 h-24 bg-indigo-600 rounded-[2rem] flex items-center justify-center mb-8 shadow-2xl shadow-indigo-600/20">
          <ImageIcon className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-4xl font-black mb-4 tracking-tight text-white">TeleGallery</h1>
        <p className="text-slate-400 max-w-md mb-12 text-lg">
          Tu galería personal conectada a Telegram. Segura, privada y gratuita para siempre.
        </p>
        <button
          onClick={loginWithGoogle}
          className="flex items-center gap-4 px-8 py-4 bg-white text-black rounded-2xl font-bold hover:bg-slate-100 transition-all shadow-xl hover:scale-105 active:scale-95"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-6 h-6" />
          Continuar con Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Global Upload Progress */}
      <AnimatePresence>
        {uploading && uploadProgress && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl flex items-center gap-4 w-[90%] max-w-md"
          >
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center shrink-0">
              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
            </div>
            <div className="flex-1">
              <div className="flex justify-between text-sm font-bold mb-2">
                <span className="truncate max-w-[200px]">
                  {uploadProgress.type === 'zip' ? 'Preparando ZIP...' : 
                   uploadProgress.type === 'download' ? 'Descargando archivos...' : 
                   `Subiendo: ${uploadProgress.currentFileName || 'Archivo'}`}
                </span>
                <span className="text-indigo-400">
                  {uploadProgress.percent !== undefined 
                    ? `${Math.round(((uploadProgress.current - 1) / uploadProgress.total) * 100 + (uploadProgress.percent / uploadProgress.total))}%` 
                    : `${uploadProgress.current} / ${uploadProgress.total}`}
                </span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ 
                    width: `${uploadProgress.percent !== undefined 
                      ? ((uploadProgress.current - 1) / uploadProgress.total) * 100 + (uploadProgress.percent / uploadProgress.total) 
                      : (uploadProgress.current / uploadProgress.total) * 100}%` 
                  }}
                  className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                />
              </div>
              <div className="mt-2 flex justify-between items-center text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                <div className="flex flex-col gap-0.5">
                  <span>Archivo {uploadProgress.current} de {uploadProgress.total}</span>
                  {uploadProgress.percent !== undefined && (
                    <span className="text-indigo-400/80">Progreso: {uploadProgress.percent}%</span>
                  )}
                </div>
                {(uploadProgress.currentSize !== undefined || uploadProgress.totalSize !== undefined) && (
                  <div className="flex flex-col items-end gap-0.5">
                    <span>{formatSize(uploadProgress.currentSize || 0)} / {formatSize(uploadProgress.totalSize || 0)}</span>
                    {uploadProgress.totalFilesSize && (
                      <span className="text-indigo-400/60 lowercase">Total: {formatSize(uploadProgress.totalFilesSize)}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              TeleGallery
            </h1>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
            <button 
              onClick={() => setIsSelectionMode(!isSelectionMode)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                isSelectionMode 
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
                  : "bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400"
              )}
            >
              {isSelectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              <span className="hidden sm:inline">{isSelectionMode ? 'Cancelar' : 'Seleccionar'}</span>
            </button>

            <input
              type="file"
              // @ts-ignore
              webkitdirectory="true"
              directory="true"
              multiple
              onChange={handleFolderUpload}
              className="hidden"
              ref={folderInputRef}
            />
            <button 
              onClick={syncFolder}
              className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-sm font-medium transition-all"
            >
              <FolderSync className="w-4 h-4 text-indigo-400" />
              Sincronizar Carpeta
            </button>

            <div className="flex items-center gap-3">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] font-bold text-white">{user.displayName}</span>
                <button onClick={logout} className="text-[9px] text-slate-500 hover:text-rose-400 font-bold uppercase tracking-widest transition-colors">Cerrar Sesión</button>
              </div>
              <div className="relative">
                <button onClick={() => setShowProfileMenu(!showProfileMenu)} className="focus:outline-none">
                  <img src={user.photoURL || ''} alt="Avatar" className="w-8 h-8 rounded-full border border-slate-800" />
                </button>
                <AnimatePresence>
                  {showProfileMenu && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                      <div className="p-3 border-b border-slate-800 md:hidden">
                        <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
                        <p className="text-xs text-slate-400 truncate">{user.email}</p>
                      </div>
                      <button 
                        onClick={() => { logout(); setShowProfileMenu(false); }} 
                        className="w-full text-left px-4 py-3 text-rose-400 hover:bg-slate-800 transition-colors text-sm font-bold md:hidden"
                      >
                        Cerrar Sesión
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors relative group"
              >
                <Settings className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                {!botToken || !chatId ? (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="fixed bottom-20 left-4 right-4 z-[500] bg-rose-500 text-white p-4 rounded-2xl shadow-xl text-sm font-bold text-center animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => { setError(null); }} className="ml-2 text-white/50 hover:text-white font-bold">X</button>
            </div>
          </div>
        )}
        {successMessage && (
          <div className="fixed bottom-20 left-4 right-4 z-[500] bg-emerald-500 text-white p-4 rounded-2xl shadow-xl text-sm font-bold text-center animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span>{successMessage}</span>
              <button onClick={() => { setSuccessMessage(null); }} className="ml-2 text-white/50 hover:text-white font-bold">X</button>
            </div>
          </div>
        )}
        {/* Bulk Actions Bar */}
        <AnimatePresence>
          {isSelectionMode && selectedIds.size > 0 && (
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[150] w-[95%] max-w-3xl bg-slate-900/90 backdrop-blur-xl border border-slate-700 rounded-3xl shadow-2xl p-3 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-3 px-4">
                <span className="text-indigo-400 font-bold">{selectedIds.size}</span>
                <span className="text-sm text-slate-400 hidden sm:inline">seleccionados</span>
              </div>

              <div className="flex items-center gap-2">
                <button 
                  onClick={downloadSelected}
                  className="p-2 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-xs font-bold hidden sm:inline">Descargar</span>
                </button>

                <button 
                  onClick={toggleSelectAll}
                  className="p-2 hover:bg-slate-700/50 text-slate-400 hover:text-slate-300 rounded-xl transition-colors flex items-center gap-2"
                  title={selectedIds.size === filteredAndSortedMedia.length ? "Deseleccionar todo" : "Seleccionar todo"}
                >
                  <CheckSquare className="w-4 h-4" />
                  <span className="text-xs font-bold hidden sm:inline">Todo</span>
                </button>

                <button 
                  onClick={moveSelectedToPrivate}
                  className="p-2 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 rounded-xl transition-colors flex items-center gap-2"
                >
                  {activeAlbum === 'Privado' ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <span className="text-xs font-bold hidden sm:inline">
                    {activeAlbum === 'Privado' ? 'Público' : 'Privado'}
                  </span>
                </button>

                <div className="relative">
                  <button 
                    onClick={() => setShowBatchMoveMenu(!showBatchMoveMenu)}
                    className="p-2 hover:bg-slate-800 rounded-xl text-slate-300 transition-colors flex items-center gap-2"
                  >
                    <Move className="w-4 h-4" />
                    <span className="text-xs font-bold hidden sm:inline">Mover</span>
                  </button>
                  <AnimatePresence>
                    {showBatchMoveMenu && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full mb-2 right-0 bg-slate-800 border border-slate-700 rounded-2xl shadow-xl p-2 min-w-[180px] z-[160]"
                      >
                        <p className="text-[10px] font-bold text-slate-500 uppercase p-2">Mover a álbum</p>
                        <div className="max-h-48 overflow-y-auto no-scrollbar">
                          {albums.filter(a => a !== 'Todos' && a !== 'Privado').map(album => (
                            <button 
                              key={album}
                              onClick={() => {
                                moveSelectedToAlbum(album);
                                setShowBatchMoveMenu(false);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-600 rounded-lg text-xs transition-colors"
                            >
                              {album}
                            </button>
                          ))}
                        </div>
                        <button 
                          onClick={() => {
                            const name = prompt('Nombre del nuevo álbum:');
                            if (name) {
                              moveSelectedToAlbum(name);
                              setShowBatchMoveMenu(false);
                            }
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg text-xs transition-colors flex items-center gap-2 mt-1 border-t border-slate-700 pt-2"
                        >
                          <Plus className="w-3 h-3" /> Nuevo álbum
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button 
                  onClick={deleteSelected}
                  className="p-2 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-xs font-bold hidden sm:inline">Eliminar</span>
                </button>
              </div>

              <button 
                onClick={toggleSelectAll}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[10px] font-bold transition-colors shrink-0"
              >
                {selectedIds.size === filteredAndSortedMedia.length ? 'Deseleccionar' : 'Todo'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom Confirmation Modal */}
        <AnimatePresence>
          {confirmDelete.isOpen && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmDelete({ isOpen: false })}
                className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2rem] p-8 shadow-2xl"
              >
                <div className="w-16 h-16 bg-rose-500/20 text-rose-500 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-center mb-2">¿Estás seguro?</h3>
                <p className="text-slate-400 text-center mb-8">
                  {confirmDelete.isBulk 
                    ? `Vas a eliminar ${selectedIds.size} archivos permanentemente. Esta acción no se puede deshacer.`
                    : 'Vas a eliminar este archivo permanentemente. Esta acción no se puede deshacer.'}
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmDelete({ isOpen: false })}
                    className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={confirmDeleteAction}
                    className="flex-1 py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl font-bold transition-all shadow-lg shadow-rose-600/20"
                  >
                    Eliminar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Setup Guide Alert */}
        {(!botToken || !chatId) && (
          <div className="mb-8 p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-3xl flex flex-col md:flex-row gap-6 items-center md:items-start text-center md:text-left">
            <div className="p-4 bg-indigo-500/20 rounded-2xl text-indigo-400">
              <Settings className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-indigo-300 mb-2">Configuración Necesaria</h4>
              <p className="text-slate-400 leading-relaxed mb-4">
                Para empezar a subir archivos, necesitas configurar tu Bot de Telegram. Pulsa el botón de ajustes arriba a la derecha o el botón de abajo.
              </p>
              <button 
                onClick={() => setShowSettings(true)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-600/20"
              >
                Configurar ahora
              </button>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <section className="mb-12">
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1">
              <div
                {...getRootProps()}
                className={cn(
                  "relative group cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed transition-all duration-500",
                  isDragActive 
                    ? "border-indigo-500 bg-indigo-500/5 scale-[1.01]" 
                    : "border-slate-800 hover:border-slate-700 bg-slate-900/30",
                  uploading && "pointer-events-none opacity-50"
                )}
              >
                <input {...getInputProps()} />
                <div className="px-6 py-12 flex flex-col items-center text-center">
                  <div className={cn(
                    "w-16 h-16 mb-4 rounded-2xl flex items-center justify-center transition-all duration-500 group-hover:rotate-6 group-hover:scale-110 shadow-2xl",
                    isDragActive ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400"
                  )}>
                    {uploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
                  </div>
                  <h2 className="text-xl font-bold mb-1 tracking-tight">
                    {uploading ? (uploadProgress?.type === 'download' ? "Descargando..." : "Subiendo...") : "Subir Archivos"}
                  </h2>
                  {uploadProgress && (
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-indigo-400 text-sm font-bold">
                        {uploadProgress.percent !== undefined ? `${uploadProgress.percent}%` : ""}
                      </p>
                      <p className="text-slate-400 text-xs font-medium">
                        Archivo {uploadProgress.current} de {uploadProgress.total}
                      </p>
                    </div>
                  )}
                  {!uploading && <p className="text-slate-400 text-sm">Arrastra o haz clic para subir</p>}
                </div>
                {uploading && (
                  <div className="absolute bottom-0 left-0 h-1 bg-indigo-500/20 w-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                      style={{ width: uploadProgress ? `${(uploadProgress.current / uploadProgress.total) * 100}%` : '100%' }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="w-full md:w-64 space-y-4">
              <button 
                onClick={syncFolder}
                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 border border-slate-800 rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all"
              >
                <FolderSync className="w-4 h-4 text-indigo-400" />
                Sincronizar Carpeta
              </button>
            </div>
          </div>
        </section>

        {/* Filters & Sorting */}
        <section className="mb-8">
          <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
            <div className="flex items-center gap-2 w-full overflow-hidden">
              <Filter className="w-4 h-4 text-slate-500 mr-2 shrink-0" />
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1">
                {albums.map(album => (
                  <div key={album} className="flex items-center gap-2 shrink-0 relative group/album">
                    <button
                      onClick={() => {
                        if (album === 'Privado' && isPrivateLocked) {
                          setIsSettingPassword(false);
                          setShowPasswordModal(true);
                        }
                        setActiveAlbum(album);
                      }}
                      className={cn(
                        "px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap border flex items-center gap-2",
                        activeAlbum === album 
                          ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20" 
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                      )}
                    >
                      {album === 'Privado' && (isPrivateLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />)}
                      {album}
                      {album === 'Privado' && media.filter(m => m.isPrivate).length > 0 && (
                        <span className="ml-1 text-[10px] bg-white/20 px-1.5 rounded-full">
                          {media.filter(m => m.isPrivate).length}
                        </span>
                      )}
                    </button>
                    {isSelectionMode && album !== 'Todos' && album !== 'Privado' && album !== 'General' && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if(window.confirm(`¿Eliminar álbum "${album}"? Las fotos no se borrarán.`)) {
                            handleDeleteAlbum(album);
                          }
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-100 transition-opacity shadow-lg z-10"
                        title="Eliminar álbum"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setShowCreateAlbumModal(true)}
                className="p-2 bg-slate-900 border border-slate-800 text-indigo-400 rounded-full hover:bg-slate-800 transition-all shrink-0 ml-2"
                title="Nuevo Álbum"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-2xl px-4 py-2">
              <SortAsc className="w-4 h-4 text-slate-500" />
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
              >
                <option value="date-desc">Más recientes</option>
                <option value="date-asc">Más antiguos</option>
                <option value="name-asc">Nombre (A-Z)</option>
                <option value="name-desc">Nombre (Z-A)</option>
                <option value="type">Tipo de archivo</option>
              </select>
            </div>
          </div>
        </section>

        {/* Gallery */}
        <section>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-square bg-slate-900/50 rounded-2xl animate-pulse border border-slate-800" />
              ))}
            </div>
          ) : filteredAndSortedMedia.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              <AnimatePresence mode="popLayout">
                {filteredAndSortedMedia.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => {
                      if (isSelectionMode) {
                        toggleSelect(item.id);
                      } else {
                        setSelectedMedia(item);
                        resetEditor(item);
                      }
                    }}
                    className={cn(
                      "group relative aspect-square bg-slate-900 rounded-2xl overflow-hidden border transition-all duration-300 shadow-xl cursor-pointer",
                      isSelectionMode && selectedIds.has(item.id) 
                        ? "border-indigo-500 ring-4 ring-indigo-500/20 scale-95" 
                        : "border-slate-800 hover:border-indigo-500/50"
                    )}
                  >
                    <MediaRenderer
                      fileId={item.fileId}
                      type={item.type}
                      name={item.name}
                      botToken={botToken}
                      edits={item.edits}
                      isThumbnail={true}
                      isLarge={item.isLarge}
                      chatId={item.chatId}
                      messageId={item.messageId}
                      sessionString={sessionString}
                      apiId={apiId}
                      apiHash={apiHash}
                    />

                    {/* Selection Checkbox */}
                    {isSelectionMode && (
                      <div className="absolute top-3 right-3 z-20">
                        <div className={cn(
                          "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                          selectedIds.has(item.id) 
                            ? "bg-indigo-600 border-indigo-500" 
                            : "bg-black/40 border-white/40 backdrop-blur-md"
                        )}>
                          {selectedIds.has(item.id) && <Check className="w-4 h-4 text-white" />}
                        </div>
                      </div>
                    )}

                    {/* Overlay */}
                    {!isSelectionMode && (
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-0 md:group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-5 translate-y-4 md:group-hover:translate-y-0">
                        <p className="text-sm font-bold truncate mb-1">{item.name}</p>
                        <p className="text-[10px] text-indigo-400 font-bold mb-3 uppercase tracking-widest">{item.album}</p>
                        
                        <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setSelectedMedia(item);
                                resetEditor(item);
                              }}
                              className="p-2 bg-white/10 hover:bg-indigo-500 text-white rounded-xl backdrop-blur-md transition-all hover:scale-110"
                              title="Ver en pantalla completa"
                            >
                              <Maximize2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => downloadMedia(item)}
                              className="p-2 bg-white/10 hover:bg-emerald-500 text-white rounded-xl backdrop-blur-md transition-all hover:scale-110"
                              title="Descargar"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                          <button
                            onClick={() => deleteMedia(item.id)}
                            className="p-2 bg-white/10 hover:bg-rose-500 text-white rounded-xl backdrop-blur-md transition-all hover:scale-110"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Mobile Quick Actions */}
                    {!isSelectionMode && (
                      <div className="md:hidden absolute bottom-2 right-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => downloadMedia(item)}
                          className="p-2 bg-slate-950/80 text-white rounded-lg backdrop-blur-md border border-white/10"
                          title="Descargar"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteMedia(item.id)}
                          className="p-2 bg-slate-950/80 text-rose-400 rounded-lg backdrop-blur-md border border-white/10"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-32 text-slate-500 border-2 border-dashed border-slate-900 rounded-[2.5rem] bg-slate-900/10">
              <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center mb-6 border border-slate-800">
                <ImageIcon className="w-10 h-10 opacity-20" />
              </div>
              <p className="text-lg font-medium mb-1">No hay archivos en este álbum</p>
              <p className="text-sm opacity-60">Sube algo nuevo o cambia de álbum</p>
            </div>
          )}
        </section>
      </main>

      {/* Full Screen Modal */}
      <AnimatePresence>
        {selectedMedia && (
          <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/95 backdrop-blur-3xl"
            />
            
            {/* Top Bar */}
            <div className="absolute top-0 left-0 right-0 z-30 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent pt-safe">
              <button 
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                    setActiveEditTab('none' as any);
                  } else {
                    setSelectedMedia(null);
                  }
                }}
                className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
              >
                {isEditing ? <X className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
              </button>
              
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <button 
                      onClick={() => setActiveEditTab(activeEditTab === 'filters' ? 'none' as any : 'filters')}
                      className={cn("p-3 rounded-full transition-all", activeEditTab === 'filters' ? "bg-white/20 text-white" : "text-white hover:bg-white/10")}
                    >
                      <Layers className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={() => setActiveEditTab(activeEditTab === 'markup' ? 'none' as any : 'markup')}
                      className={cn("p-3 rounded-full transition-all", activeEditTab === 'markup' ? "bg-white/20 text-white" : "text-white hover:bg-white/10")}
                    >
                      <PenTool className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={handleSaveEdits}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-bold transition-all ml-2"
                    >
                      Listo
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                        setIsEditing(true);
                        setActiveEditTab('filters');
                      }}
                      className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
                    >
                      <PenTool className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={() => downloadMedia(selectedMedia)}
                      className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
                      title="Descargar"
                    >
                      <Download className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={() => setConfirmDelete({ isOpen: true, id: selectedMedia.id })}
                      className="p-3 text-red-400 hover:bg-red-400/10 rounded-full transition-all"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Main Content Area */}
            <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden group/modal">
              {/* Navigation Arrows (Hidden in Edit Mode) */}
              {!isEditing && (
                <>
                  <button 
                    onClick={() => navigateMedia('prev')}
                    className="absolute left-6 top-1/2 -translate-y-1/2 z-20 p-5 bg-black/20 hover:bg-white/10 text-white rounded-full backdrop-blur-xl transition-all opacity-0 group-hover/modal:opacity-100 hidden md:block border border-white/5"
                  >
                    <ChevronLeft className="w-8 h-8" />
                  </button>
                  <button 
                    onClick={() => navigateMedia('next')}
                    className="absolute right-6 top-1/2 -translate-y-1/2 z-20 p-5 bg-black/20 hover:bg-white/10 text-white rounded-full backdrop-blur-xl transition-all opacity-0 group-hover/modal:opacity-100 hidden md:block border border-white/5"
                  >
                    <ChevronRight className="w-8 h-8" />
                  </button>
                </>
              )}

              <motion.div 
                key={selectedMedia.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                drag={!isEditing ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                dragTransition={{ power: 0.2, timeConstant: 200 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x > 50) navigateMedia('prev');
                  else if (info.offset.x < -50) navigateMedia('next');
                }}
                className={cn(
                  "w-full h-full flex items-center justify-center p-4 md:p-12",
                  !isEditing ? "cursor-grab active:cursor-grabbing" : ""
                )}
              >
                {selectedMedia.type === 'photo' ? (
                    <div 
                      className="relative w-full h-full flex items-center justify-center overflow-hidden transition-all duration-500 bg-black/10 rounded-2xl"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                      }}
                    >
                      <>
                        <MediaRenderer
                          fileId={selectedMedia.fileId}
                          type={selectedMedia.type}
                          name={selectedMedia.name}
                          botToken={botToken}
                          onLoad={(e) => {
                            const img = e.currentTarget;
                            setImageAspectRatio(img.naturalWidth / img.naturalHeight);
                          }}
                          style={{ 
                            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom}) scaleX(${flipX ? -1 : 1})`,
                            filter: isComparing ? 'none' : `brightness(${brightness}%) contrast(${contrast}%) grayscale(${grayscale}%) sepia(${sepiaValue + warmth}%) blur(${blur}px) hue-rotate(${hueRotate}deg) invert(${invert}%) saturate(${saturate}%)`,
                            objectFit: 'contain',
                          }}
                          className={cn(
                            "max-w-full max-h-full transition-all duration-300 select-none shadow-2xl pointer-events-none"
                          )}
                          isLarge={selectedMedia.isLarge}
                          chatId={selectedMedia.chatId}
                          messageId={selectedMedia.messageId}
                          sessionString={sessionString}
                          apiId={apiId}
                          apiHash={apiHash}
                        />
                        {vignette > 0 && !isComparing && (
                          <div 
                            className="absolute inset-0 pointer-events-none transition-all duration-300"
                            style={{ 
                              background: `radial-gradient(circle, transparent ${100 - vignette}%, black 150%)`
                            }}
                          />
                        )}
                        {activeEditTab === 'markup' && (
                            <canvas
                              ref={canvasRef}
                              className="absolute inset-0 w-full h-full cursor-crosshair"
                              onMouseDown={(e) => {
                                const canvas = canvasRef.current;
                                if (!canvas) return;
                                const ctx = canvas.getContext('2d');
                                if (!ctx) return;
                                setIsDrawing(true);
                                const rect = canvas.getBoundingClientRect();
                                ctx.beginPath();
                                ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
                                ctx.strokeStyle = brushColor;
                                ctx.lineWidth = brushSize;
                                ctx.lineCap = 'round';
                                ctx.lineJoin = 'round';
                              }}
                              onMouseMove={(e) => {
                                if (!isDrawing) return;
                                const canvas = canvasRef.current;
                                if (!canvas) return;
                                const ctx = canvas.getContext('2d');
                                if (!ctx) return;
                                const rect = canvas.getBoundingClientRect();
                                ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                                ctx.stroke();
                              }}
                              onMouseUp={() => setIsDrawing(false)}
                              onMouseLeave={() => setIsDrawing(false)}
                              onTouchStart={(e) => {
                                const canvas = canvasRef.current;
                                if (!canvas) return;
                                const ctx = canvas.getContext('2d');
                                if (!ctx) return;
                                const rect = canvas.getBoundingClientRect();
                                const touch = e.touches[0];
                                setIsDrawing(true);
                                ctx.beginPath();
                                ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
                                ctx.strokeStyle = brushColor;
                                ctx.lineWidth = brushSize;
                                ctx.lineCap = 'round';
                                ctx.lineJoin = 'round';
                              }}
                              onTouchMove={(e) => {
                                if (!isDrawing) return;
                                const canvas = canvasRef.current;
                                if (!canvas) return;
                                const ctx = canvas.getContext('2d');
                                if (!ctx) return;
                                const rect = canvas.getBoundingClientRect();
                                const touch = e.touches[0];
                                ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
                                ctx.stroke();
                              }}
                              onTouchEnd={() => setIsDrawing(false)}
                            />
                          )}
                        </>
                    </div>
                ) : (
                  <MediaRenderer
                    fileId={selectedMedia.fileId}
                    type={selectedMedia.type}
                    name={selectedMedia.name}
                    botToken={botToken}
                    className="max-w-full max-h-full rounded-2xl shadow-2xl"
                    isLarge={selectedMedia.isLarge}
                    chatId={selectedMedia.chatId}
                    messageId={selectedMedia.messageId}
                    sessionString={sessionString}
                    apiId={apiId}
                    apiHash={apiHash}
                  />
                )}
              </motion.div>
            </div>

            {/* Bottom Bar / Editor */}
            <div className="w-full bg-black/90 backdrop-blur-2xl border-t border-white/5 pb-safe">
              {isEditing ? (
                <div className="flex flex-col">
                  {/* Tools Area */}
                  <div className="h-48 flex items-center justify-center px-4 overflow-x-auto no-scrollbar touch-pan-x">
                    <div className="flex gap-4 min-w-max">
                      {activeEditTab === 'suggestions' && (
                        <div className="flex gap-4">
                          <button onClick={() => { setBrightness(110); setContrast(110); setSaturate(120); }} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 bg-white/5 group-hover:bg-indigo-600 rounded-2xl flex items-center justify-center transition-all border border-white/10">
                              <Sparkles className="w-6 h-6" />
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Automático</span>
                          </button>
                          <button onClick={() => { setGrayscale(100); }} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 bg-white/5 group-hover:bg-indigo-600 rounded-2xl flex items-center justify-center transition-all border border-white/10">
                              <Layers className="w-6 h-6" />
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">B&N</span>
                          </button>
                        </div>
                      )}
                      
                      {activeEditTab === 'adjust' && (
                        <div className="flex flex-col w-full max-w-lg mx-auto py-4">
                          {/* Active Slider */}
                          <div className="max-w-[240px] mx-auto mb-6 space-y-3">
                            <div className="flex justify-between text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                              <span>{
                                activeAdjustTool === 'brightness' ? 'Brillo' :
                                activeAdjustTool === 'contrast' ? 'Contraste' :
                                activeAdjustTool === 'saturate' ? 'Saturación' :
                                activeAdjustTool === 'warmth' ? 'Calidez' :
                                activeAdjustTool === 'vignette' ? 'Viñeta' :
                                activeAdjustTool === 'blur' ? 'Desenfoque' :
                                activeAdjustTool === 'hue' ? 'Tono' : 'Invertir'
                              }</span>
                              <span>{
                                activeAdjustTool === 'brightness' ? brightness :
                                activeAdjustTool === 'contrast' ? contrast :
                                activeAdjustTool === 'saturate' ? saturate :
                                activeAdjustTool === 'warmth' ? warmth :
                                activeAdjustTool === 'vignette' ? vignette :
                                activeAdjustTool === 'blur' ? blur :
                                activeAdjustTool === 'hue' ? hueRotate : invert
                              }{activeAdjustTool === 'hue' ? '°' : '%'}</span>
                            </div>
                            <input 
                              type="range" 
                              min={activeAdjustTool === 'hue' ? "0" : "0"} 
                              max={
                                activeAdjustTool === 'hue' ? "360" : 
                                activeAdjustTool === 'blur' ? "20" : "200"
                              } 
                              value={
                                activeAdjustTool === 'brightness' ? brightness :
                                activeAdjustTool === 'contrast' ? contrast :
                                activeAdjustTool === 'saturate' ? saturate :
                                activeAdjustTool === 'warmth' ? warmth :
                                activeAdjustTool === 'vignette' ? vignette :
                                activeAdjustTool === 'blur' ? blur :
                                activeAdjustTool === 'hue' ? hueRotate : invert
                              } 
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (activeAdjustTool === 'brightness') setBrightness(val);
                                else if (activeAdjustTool === 'contrast') setContrast(val);
                                else if (activeAdjustTool === 'saturate') setSaturate(val);
                                else if (activeAdjustTool === 'warmth') setWarmth(val);
                                else if (activeAdjustTool === 'vignette') setVignette(val);
                                else if (activeAdjustTool === 'blur') setBlur(val);
                                else if (activeAdjustTool === 'hue') setHueRotate(val);
                                else setInvert(val);
                              }} 
                              className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-500" 
                            />
                          </div>

                          {/* Tool List */}
                          <div className="flex gap-4 px-4 overflow-x-auto no-scrollbar pb-2">
                            {[
                              { id: 'brightness', name: 'Brillo', icon: Sun },
                              { id: 'contrast', name: 'Contraste', icon: Contrast },
                              { id: 'saturate', name: 'Saturación', icon: Droplets },
                              { id: 'warmth', name: 'Calidez', icon: Thermometer },
                              { id: 'vignette', name: 'Viñeta', icon: Focus },
                              { id: 'blur', name: 'Desenfoque', icon: Cloud },
                              { id: 'hue', name: 'Tono', icon: Palette },
                              { id: 'invert', name: 'Invertir', icon: Zap },
                            ].map((tool) => (
                              <button 
                                key={tool.id}
                                onClick={() => setActiveAdjustTool(tool.id)}
                                className="flex flex-col items-center gap-3 shrink-0 group"
                              >
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-tighter transition-all",
                                  activeAdjustTool === tool.id ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"
                                )}>
                                  {tool.name}
                                </span>
                                <div className={cn(
                                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all border",
                                  activeAdjustTool === tool.id 
                                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-400" 
                                    : "bg-white/5 border-white/10 text-slate-500 group-hover:bg-white/10 group-hover:text-slate-300"
                                )}>
                                  <tool.icon className="w-5 h-5" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeEditTab === 'filters' && (
                        <div className="flex gap-4 px-4 py-4 overflow-x-auto no-scrollbar w-full">
                          {[
                            { name: 'Original', filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepiaValue: 0, warmth: 0, hueRotate: 0 } },
                            { name: 'Vívido', filters: { brightness: 110, contrast: 110, saturate: 130, grayscale: 0, sepiaValue: 0, warmth: 10, hueRotate: 0 } },
                            { name: 'Cálido', filters: { brightness: 100, contrast: 100, saturate: 110, grayscale: 0, sepiaValue: 20, warmth: 30, hueRotate: 0 } },
                            { name: 'Frío', filters: { brightness: 100, contrast: 100, saturate: 110, grayscale: 0, sepiaValue: 0, warmth: 0, hueRotate: 190 } },
                            { name: 'Mono', filters: { brightness: 100, contrast: 120, saturate: 100, grayscale: 100, sepiaValue: 0, warmth: 0, hueRotate: 0 } },
                            { name: 'Noir', filters: { brightness: 80, contrast: 150, saturate: 100, grayscale: 100, sepiaValue: 0, warmth: 0, hueRotate: 0 } },
                          ].map((f) => (
                            <button 
                              key={f.name}
                              onClick={() => {
                                setBrightness(f.filters.brightness);
                                setContrast(f.filters.contrast);
                                setSaturate(f.filters.saturate);
                                setGrayscale(f.filters.grayscale);
                                setSepiaValue(f.filters.sepiaValue);
                                setWarmth(f.filters.warmth);
                                setHueRotate(f.filters.hueRotate);
                              }}
                              className="flex flex-col items-center gap-2 group shrink-0"
                            >
                              <div className="w-20 h-20 bg-white/5 group-hover:bg-indigo-600 rounded-2xl flex items-center justify-center transition-all border border-white/10 overflow-hidden relative">
                                {editingImageUrl ? (
                                  <img 
                                    src={editingImageUrl} 
                                    className="w-full h-full object-cover opacity-50"
                                    style={{ 
                                      filter: `brightness(${f.filters.brightness}%) contrast(${f.filters.contrast}%) grayscale(${f.filters.grayscale}%) sepia(${f.filters.sepiaValue + f.filters.warmth}%) hue-rotate(${f.filters.hueRotate}deg) saturate(${f.filters.saturate}%)`
                                    }}
                                    alt={f.name}
                                  />
                                ) : (
                                  <ImageIcon className="w-6 h-6 text-slate-500" />
                                )}
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-[8px] font-black text-white uppercase tracking-tighter drop-shadow-md">{f.name}</span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {activeEditTab === 'markup' && (
                        <div className="flex flex-col gap-4 px-8 py-4 items-center">
                          <div className="flex gap-4">
                            {['#ffffff', '#000000', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(color => (
                              <button 
                                key={color}
                                onClick={() => setBrushColor(color)}
                                className={cn(
                                  "w-8 h-8 rounded-full border-2 transition-all",
                                  brushColor === color ? "border-white scale-110" : "border-transparent"
                                )}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                          <div className="flex items-center gap-8 w-full max-w-md">
                            <div className="flex-1 space-y-2">
                              <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                <span>Tamaño</span>
                                <span>{brushSize}px</span>
                              </div>
                              <input type="range" min="1" max="50" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-500" />
                            </div>
                            <button 
                              onClick={() => {
                                const canvas = canvasRef.current;
                                if (canvas) {
                                  const ctx = canvas.getContext('2d');
                                  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
                                }
                              }}
                              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shrink-0"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom area is empty now since tools are at the top */}
                </div>
              ) : (
                <div className="flex items-center justify-around p-4 h-24">
                  <button 
                    onClick={() => downloadMedia(selectedMedia)}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <div className="p-2 group-hover:bg-white/10 rounded-full transition-all">
                      <Download className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-[10px] font-medium text-slate-400">Descargar</span>
                  </button>
                  
                  {selectedMedia.type === 'photo' && (
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div className="p-2 group-hover:bg-white/10 rounded-full transition-all">
                        <Palette className="w-6 h-6 text-white" />
                      </div>
                      <span className="text-[10px] font-medium text-slate-400">Editar</span>
                    </button>
                  )}

                  <div className="relative">
                    <button 
                      onClick={() => setShowAddToMenu(!showAddToMenu)}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div className="p-2 group-hover:bg-white/10 rounded-full transition-all">
                        <Plus className="w-6 h-6 text-white" />
                      </div>
                      <span className="text-[10px] font-medium text-slate-400">Agregar a</span>
                    </button>
                    
                    <AnimatePresence>
                      {showAddToMenu && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-56 bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl z-50"
                        >
                          <div className="p-4 border-b border-white/5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Agregar a</span>
                          </div>
                          {albums.filter(a => a !== 'Todos' && a !== 'Sincronizado' && a !== 'Privado').map(album => (
                            <button 
                              key={album}
                              onClick={() => handleMoveToAlbum(album)}
                              className="w-full p-4 flex items-center gap-4 hover:bg-white/5 transition-all text-left"
                            >
                              <ImageIcon className="w-5 h-5 text-slate-400" />
                              <span className="text-sm font-medium">{album}</span>
                            </button>
                          ))}
                          <button 
                            onClick={() => {
                              setShowCreateAlbumModal(true);
                              setShowAddToMenu(false);
                            }}
                            className="w-full p-4 flex items-center gap-4 hover:bg-white/5 transition-all text-left border-t border-white/5"
                          >
                            <Plus className="w-5 h-5 text-indigo-400" />
                            <span className="text-sm font-medium text-indigo-400">Nuevo álbum</span>
                          </button>
                          <button 
                            onClick={() => {
                              setAlbumSelectorMode('move');
                              setShowAlbumSelector(true);
                              setShowAddToMenu(false);
                            }}
                            className="w-full p-4 flex items-center gap-4 hover:bg-white/5 transition-all text-left border-t border-white/5"
                          >
                            <Move className="w-5 h-5 text-slate-400" />
                            <span className="text-sm font-medium">Mover o copiar a álbum</span>
                          </button>
                          <div className="p-4 border-t border-white/5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Seguridad</span>
                          </div>
                          <button 
                            onClick={handleTogglePrivate}
                            className="w-full p-4 flex items-center gap-4 hover:bg-white/5 transition-all text-left"
                          >
                            <Lock className="w-5 h-5 text-slate-400" />
                            <span className="text-sm font-medium">
                              {selectedMedia.isPrivate ? 'Mover a galería pública' : 'Mover a carpeta privada'}
                            </span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button 
                    onClick={() => {
                      deleteMedia(selectedMedia.id);
                      setSelectedMedia(null);
                    }}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <div className="p-2 group-hover:bg-rose-500/20 rounded-full transition-all">
                      <Trash2 className="w-6 h-6 text-rose-500" />
                    </div>
                    <span className="text-[10px] font-medium text-slate-400">Papelera</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Album Selector Modal */}
      <AnimatePresence>
        {showAlbumSelector && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAlbumSelector(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2rem] p-8 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <FolderSync className="w-6 h-6 text-indigo-400" />
                Seleccionar Álbum
              </h3>
              
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 mb-6">
                {albums.filter(a => a !== 'Todos' && a !== 'Privado').map(album => (
                  <button 
                    key={album}
                    onClick={() => {
                      // We'll set a temporary state to show the move/copy buttons for this album
                      // Or just use a simpler approach: click album, then show move/copy buttons
                      // Let's use a state for the selected target album
                      (window as any)._selectedTargetAlbum = album;
                      const buttons = document.getElementById('move-copy-buttons');
                      if (buttons) buttons.classList.remove('hidden');
                      
                      // Highlight selected
                      document.querySelectorAll('.album-btn').forEach(el => el.classList.remove('bg-indigo-600/20', 'border-indigo-500/50'));
                      const btn = document.getElementById(`album-btn-${album}`);
                      if (btn) btn.classList.add('bg-indigo-600/20', 'border-indigo-500/50');
                    }}
                    id={`album-btn-${album}`}
                    className="album-btn w-full p-4 flex items-center gap-4 bg-slate-950/50 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-all text-left"
                  >
                    <ImageIcon className="w-5 h-5 text-slate-400" />
                    <span className="text-sm font-medium">{album}</span>
                  </button>
                ))}
              </div>

              <div id="move-copy-buttons" className="hidden flex gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <button 
                  onClick={() => {
                    const album = (window as any)._selectedTargetAlbum;
                    if (album) handleMoveOrCopy(album, 'move');
                  }}
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  <Move className="w-4 h-4" />
                  Mover
                </button>
                <button 
                  onClick={() => {
                    const album = (window as any)._selectedTargetAlbum;
                    if (album) handleMoveOrCopy(album, 'copy');
                  }}
                  className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copiar
                </button>
              </div>
              
              <button 
                onClick={() => setShowAlbumSelector(false)}
                className="w-full mt-4 py-3 text-slate-400 hover:text-white text-sm font-medium transition-all"
              >
                Cancelar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Album Modal */}
      <AnimatePresence>
        {showCreateAlbumModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateAlbumModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2rem] p-8 shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-6">Nuevo Álbum</h3>
              <input 
                type="text" 
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 mb-6 focus:outline-none focus:border-indigo-500 transition-all"
                placeholder="Nombre del álbum..."
                autoFocus
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowCreateAlbumModal(false)}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleCreateAlbum}
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all"
                >
                  Crear
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPasswordModal(false)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-indigo-500/20 text-indigo-400 rounded-3xl flex items-center justify-center mb-8 mx-auto">
                <Lock className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold mb-2">
                {isSettingPassword 
                  ? (isConfirmingPassword ? 'Confirmar Contraseña' : 'Configurar Carpeta Privada') 
                  : 'Carpeta Privada'}
              </h3>
              <p className="text-slate-400 mb-8">
                {isSettingPassword 
                  ? (isConfirmingPassword ? 'Introduce la contraseña de nuevo para confirmar.' : 'Establece una contraseña para proteger tus archivos privados.') 
                  : 'Introduce tu contraseña para acceder.'}
              </p>
              <input 
                type="password" 
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 mb-8 text-center text-2xl tracking-[1em] focus:outline-none focus:border-indigo-500 transition-all font-mono"
                placeholder="••••"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              />
              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    setShowPasswordModal(false);
                    setIsConfirmingPassword(false);
                    setPasswordInput('');
                  }}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handlePasswordSubmit}
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/20"
                >
                  {isSettingPassword ? (isConfirmingPassword ? 'Confirmar' : 'Siguiente') : 'Desbloquear'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold tracking-tight">Ajustes Telegram</h2>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="p-2 hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <form onSubmit={saveSettings} className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">
                      Bot Token
                    </label>
                    <input 
                      type="password"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder="123456789:ABCDEF..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">
                      Chat ID
                    </label>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        value={chatId}
                        onChange={(e) => setChatId(e.target.value)}
                        placeholder="55882211"
                        list="saved-chat-ids"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                        required
                      />
                      <datalist id="saved-chat-ids">
                        {savedChatIds.map((id) => (
                          <option key={id} value={id} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!botToken) return setError('Primero pon el Bot Token');
                          setUploading(true);
                          try {
                            const response = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`);
                            const updates = response.data.result;
                            if (updates && updates.length > 0) {
                              // Buscar el ID en el último mensaje o post de canal
                              const lastUpdate = updates[updates.length - 1];
                              const id = lastUpdate.channel_post?.chat?.id || lastUpdate.message?.chat?.id;
                              if (id) {
                                setChatId(id.toString());
                                setSuccessMessage('¡ID detectado con éxito!');
                              } else {
                                setError('No se encontró ID. Envía un mensaje al canal primero.');
                              }
                            } else {
                              setError('Sin mensajes recientes. Envía algo al canal y prueba de nuevo.');
                            }
                          } catch (err) {
                            setError('Error al conectar con Telegram');
                          } finally {
                            setUploading(false);
                            setTimeout(() => setError(null), 3000);
                          }
                        }}
                        className="p-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-xl transition-all border border-indigo-500/30"
                        title="Detectar ID automáticamente"
                      >
                        <Search className="w-5 h-5" />
                      </button>
                    </div>
                    {botToken.startsWith(chatId) && chatId.length > 5 && (
                      <p className="mt-2 text-[10px] text-rose-400 font-bold animate-pulse">
                        ⚠️ ¡Atención! Parece que has puesto el ID del Bot como Chat ID. Debes poner TU ID personal (consíguelo en @userinfobot).
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                      Envía un mensaje a <a href="https://t.me/userinfobot" target="_blank" className="text-indigo-400 underline">@userinfobot</a> para obtener tu ID personal.
                    </p>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                  >
                    <Check className="w-5 h-5" />
                    Guardar Configuración
                  </button>

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500 font-bold">Descargas</span></div>
                  </div>

                  <div className="space-y-3">
                    <button 
                      type="button"
                      onClick={async () => {
                        try {
                          if (!('showDirectoryPicker' in window)) {
                            throw new Error('Tu navegador no soporta la selección de carpetas. Usa Chrome o Edge.');
                          }
                          const handle = await (window as any).showDirectoryPicker();
                          await updateDownloadDirHandle(handle);
                          setSuccessMessage('Carpeta de descarga configurada');
                        } catch (err: any) {
                          if (err.name !== 'AbortError') {
                            setError(err.message || 'Error al seleccionar carpeta');
                          }
                        } finally {
                          setTimeout(() => setError(null), 3000);
                        }
                      }}
                      className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Move className="w-4 h-4" />
                      {downloadDirHandle ? `Carpeta: ${downloadDirHandle.name}` : 'Seleccionar Carpeta de Descarga'}
                    </button>
                    {downloadDirHandle && (
                      <button 
                        type="button"
                        onClick={() => updateDownloadDirHandle(null)}
                        className="w-full text-[10px] text-rose-400 font-bold hover:text-rose-300 transition-colors"
                      >
                        Restablecer a descargas predeterminadas
                      </button>
                    )}
                  </div>

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500 font-bold">Modo Pro (2GB)</span></div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">API ID</label>
                        <input 
                          type="text"
                          value={apiId}
                          onChange={(e) => setApiId(e.target.value)}
                          placeholder="1234567"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">API Hash</label>
                        <input 
                          type="password"
                          value={apiHash}
                          onChange={(e) => setApiHash(e.target.value)}
                          placeholder="abcdef..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                        />
                      </div>
                    </div>

                    {sessionString ? (
                      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center">
                            <Check className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-emerald-400">Cuenta Conectada</p>
                            <p className="text-[10px] text-emerald-500/70">Límite de 2GB activado</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setSessionString('')}
                          className="text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-colors"
                        >
                          Cerrar Sesión
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {loginStep === 'none' && (
                          <button 
                            type="button"
                            onClick={() => setLoginStep('phone')}
                            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                          >
                            <Unlock className="w-4 h-4" />
                            Conectar Cuenta Personal (2GB)
                          </button>
                        )}

                        {loginStep === 'phone' && (
                          <div className="flex gap-2">
                            <input 
                              type="tel"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value)}
                              placeholder="+34600000000"
                              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                            />
                            <button 
                              type="button"
                              onClick={startLogin}
                              disabled={isLoggingIn}
                              className="px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                            >
                              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Siguiente'}
                            </button>
                          </div>
                        )}

                        {loginStep === 'code' && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input 
                                type="text"
                                value={phoneCode}
                                onChange={(e) => setPhoneCode(e.target.value)}
                                placeholder="Código de Telegram"
                                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                              />
                              <button 
                                type="button"
                                onClick={completeLogin}
                                disabled={isLoggingIn}
                                className="px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                              >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar'}
                              </button>
                            </div>
                            <button 
                              type="button"
                              onClick={() => {
                                setLoginStep('phone');
                                setError(null);
                              }}
                              className="w-full text-[10px] text-slate-500 hover:text-slate-400 font-bold transition-colors"
                            >
                              ← Volver a enviar código
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500 font-bold">Opciones de prueba</span></div>
                  </div>

                  <button 
                    type="button"
                    onClick={async () => {
                      if (!botToken || !chatId) return setError('Configura los datos primero');
                      setUploading(true);
                      try {
                        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                          chat_id: chatId,
                          text: "🔔 ¡Prueba de TeleGallery exitosa! Tu bot está correctamente configurado."
                        });
                        setSuccessMessage('¡Conexión exitosa! Revisa tu Telegram.');
                        setTimeout(() => setError(null), 5000);
                      } catch (err: any) {
                        setError('Error en la prueba: ' + (err.response?.data?.description || err.message));
                      } finally {
                        setUploading(false);
                      }
                    }}
                    disabled={uploading}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Probar Conexión (Enviar mensaje)
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-900 py-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-600 text-sm font-medium">Powered by Telegram Bot API</p>
          <p className="text-slate-800 text-[10px] mt-2 uppercase tracking-[0.2em]">TeleGallery v3.0</p>
        </div>
      </footer>
    </div>
  );
}
