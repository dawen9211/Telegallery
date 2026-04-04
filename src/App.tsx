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
  Share2, 
  Maximize2, 
  FolderSync, 
  Filter, 
  SortAsc, 
  Plus,
  Copy,
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
  Unlock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
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
  id: number;
  fileId: string;
  type: 'photo' | 'video';
  name: string;
  timestamp: string;
  album: string;
  isPrivate?: boolean;
  edits?: MediaEdits;
}

type SortOption = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'type';

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; id?: number; isBulk?: boolean }>({ isOpen: false });
  
  // Selection Mode
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
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
  const [activeEditTab, setActiveEditTab] = useState<'suggestions' | 'crop' | 'adjust' | 'filters' | 'markup'>('suggestions');
  
  const [warmth, setWarmth] = useState(0);
  const [vignette, setVignette] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  
  const [activeAdjustTool, setActiveAdjustTool] = useState('brightness');
  const [cropRatio, setCropRatio] = useState('free');
  const [showBatchMoveMenu, setShowBatchMoveMenu] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(5);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [privatePassword, setPrivatePassword] = useState(() => localStorage.getItem('tg_private_pass') || '');
  const [isPrivateLocked, setIsPrivateLocked] = useState(() => !sessionStorage.getItem('tg_private_unlocked'));
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [isConfirmingPassword, setIsConfirmingPassword] = useState(false);
  
  // Albums & Sorting
  const [activeAlbum, setActiveAlbum] = useState('Todos');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');
  const [uploadAlbum, setUploadAlbum] = useState('General');
  
  // Telegram Settings
  const [botToken, setBotToken] = useState(() => localStorage.getItem('tg_bot_token') || '');
  const [chatId, setChatId] = useState(() => localStorage.getItem('tg_chat_id') || '');
  
  const isInitialLoad = useRef(true);

  const getHeaders = useCallback(() => ({
    'x-telegram-token': botToken,
    'x-telegram-chat-id': chatId,
  }), [botToken, chatId]);

  const fetchMedia = useCallback(async () => {
    if (!chatId) {
      setMedia([]);
      setLoading(false);
      return;
    }
    
    try {
      const response = await axios.get('/api/media', { headers: getHeaders() });
      let serverMedia = response.data.media || [];
      
      // Apply local metadata (edits, private status, albums)
      const savedMetadata = localStorage.getItem('tg_media_metadata');
      if (savedMetadata) {
        try {
          const metadataMap = JSON.parse(savedMetadata);
          serverMedia = serverMedia.map((m: MediaItem) => {
            const meta = metadataMap[m.fileId];
            if (meta) {
              return { ...m, ...meta };
            }
            return m;
          });
        } catch (e) {
          console.error('Error parsing metadata:', e);
        }
      }
      
      setMedia(serverMedia);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch media:', err);
      setError('Error al cargar la galería. Revisa tu configuración de Telegram.');
    } finally {
      setLoading(false);
    }
  }, [chatId, getHeaders]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  useEffect(() => {
    if (isEditing && selectedMedia) {
      resetEditor();
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
    setShowSettings(false);
    setLoading(true);
    fetchMedia();
  };

  const deleteMedia = async (id: number) => {
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
          await axios.delete(`/api/media/${id}`, { headers: getHeaders() });
        }
        setMedia(prev => prev.filter(item => !selectedIds.has(item.id)));
        setSelectedIds(new Set());
        setIsSelectionMode(false);
      } else if (id !== undefined) {
        await axios.delete(`/api/media/${id}`, { headers: getHeaders() });
        setMedia(prev => prev.filter(item => item.id !== id));
        if (selectedIds.has(id)) {
          const newSelected = new Set(selectedIds);
          newSelected.delete(id);
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
      await axios.post('/api/media/bulk-update', {
        ids: Array.from(selectedIds),
        album: targetAlbum
      }, { headers: getHeaders() });
      
      setMedia(prev => prev.map(item => 
        selectedIds.has(item.id) ? { ...item, album: targetAlbum } : item
      ));
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setError(`Movidos ${selectedIds.size} archivos a "${targetAlbum}"`);
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
      setMedia(prev => prev.map(item => 
        selectedIds.has(item.id) ? { ...item, isPrivate: !isCurrentlyInPrivate } : item
      ));
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setError(isCurrentlyInPrivate ? `Movidos ${selectedIds.size} archivos a galería` : `Movidos ${selectedIds.size} archivos a carpeta privada`);
    } catch (err) {
      setError('Error al cambiar privacidad.');
    } finally {
      setUploading(false);
      setTimeout(() => setError(null), 2000);
    }
  };

  const shareSelected = async () => {
    if (selectedIds.size === 0) return;
    
    const selectedMediaItems = media.filter(m => selectedIds.has(m.id));
    const urls = selectedMediaItems.map(m => `${window.location.origin}/api/file/${m.fileId}?t=${botToken}`).join('\n');
    
    try {
      // @ts-ignore
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [] })) {
        setError('Preparando archivos...');
        const files = await Promise.all(selectedMediaItems.slice(0, 5).map(async (item) => {
          const url = `${window.location.origin}/api/file/${item.fileId}?t=${botToken}`;
          const response = await fetch(url);
          const blob = await response.blob();
          return new File([blob], item.name, { type: blob.type });
        }));
        
        // @ts-ignore
        if (navigator.canShare({ files })) {
          await navigator.share({
            files,
            title: 'Fotos compartidas',
            text: `Mira estas ${selectedIds.size} fotos de mi TeleGallery`
          });
          setError(null);
          return;
        }
      }
      
      if (navigator.share) {
        await navigator.share({
          title: 'Fotos compartidas',
          text: `Mira estas ${selectedIds.size} fotos de mi TeleGallery`,
          url: urls
        });
      } else {
        await copyToClipboard(urls);
        setError('Enlaces copiados al portapapeles');
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        await copyToClipboard(urls);
        setError('Enlaces copiados al portapapeles');
      }
    }
    setTimeout(() => setError(null), 2000);
  };

  const shareAlbum = async () => {
    const albumMedia = filteredAndSortedMedia;
    if (albumMedia.length === 0) return;

    const urls = albumMedia.map(m => `${window.location.origin}/api/file/${m.fileId}?t=${botToken}`).join('\n');
    const albumName = activeAlbum === 'Todos' ? 'Galería' : activeAlbum;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Álbum: ${albumName}`,
          text: `Mira mi álbum "${albumName}" con ${albumMedia.length} fotos`,
          url: urls
        });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          await copyToClipboard(urls);
          setError('Enlaces del álbum copiados');
        }
      }
    } else {
      await copyToClipboard(urls);
      setError('Enlaces del álbum copiados');
    }
    setTimeout(() => setError(null), 2000);
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

  const shareMedia = async (item: MediaItem) => {
    const url = `${window.location.origin}/api/file/${item.fileId}?t=${botToken}`;
    
    try {
      // @ts-ignore
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [] })) {
        setError('Preparando archivo...');
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], item.name, { type: blob.type });
        
        // @ts-ignore
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: item.name,
            text: `Mira esta foto de mi TeleGallery: ${item.name}`
          });
          setError(null);
          return;
        }
      }
      
      if (navigator.share) {
        await navigator.share({
          title: item.name,
          text: `Mira esta foto de mi TeleGallery: ${item.name}`,
          url: url
        });
      } else {
        await copyToClipboard(url);
        setError('Enlace copiado');
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        await copyToClipboard(url);
        setError('Enlace copiado');
      }
    }
    setTimeout(() => setError(null), 2000);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedMedia.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSortedMedia.map(m => m.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    if (!botToken || !chatId) {
      setError('Please configure your Telegram settings first.');
      setShowSettings(true);
      return;
    }

    setUploading(true);
    setError(null);

    for (const file of acceptedFiles) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('album', uploadAlbum);

      try {
        await axios.post('/api/upload', formData, {
          headers: { 
            'Content-Type': 'multipart/form-data',
            ...getHeaders()
          },
        });
      } catch (err: any) {
        console.error('Upload failed:', err);
        const telegramError = err.response?.data?.error || '';
        setError(telegramError || 'Upload failed');
        break;
      }
    }
    
    fetchMedia();
    setUploading(false);
  }, [botToken, chatId, fetchMedia, getHeaders, uploadAlbum]);

  const folderInputRef = React.useRef<HTMLInputElement>(null);
  
  // Folder Sync Logic (Experimental)
  const syncFolder = async () => {
    // Try modern API first
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore
        const directoryHandle = await window.showDirectoryPicker();
        setUploading(true);
        
        const scanDirectory = async (handle: any) => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              const file: any = await entry.getFile();
              if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                if (!media.some(m => m.name === file.name)) {
                  const formData = new FormData();
                  formData.append('file', file);
                  formData.append('album', 'Sincronizado');
                  await axios.post('/api/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data', ...getHeaders() }
                  });
                }
              }
            }
          }
        };

        await scanDirectory(directoryHandle);
        fetchMedia();
        setError('Sincronización completada');
        setTimeout(() => setError(null), 3000);
      } catch (err: any) {
        if (err.name === 'SecurityError' || err.message.includes('Cross origin')) {
          // Silently fallback to standard input for cross-origin frames
          folderInputRef.current?.click();
        } else if (err.name !== 'AbortError') {
          console.error('Directory picker error:', err);
          folderInputRef.current?.click();
        }
      } finally {
        setUploading(false);
      }
    } else {
      // Fallback to standard input
      folderInputRef.current?.click();
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const mediaFiles = Array.from(files as any).filter((f: any) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    
    for (const file of mediaFiles as any[]) {
      if (!media.some(m => m.name === file.name)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('album', 'Sincronizado');
        try {
          await axios.post('/api/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data', ...getHeaders() }
          });
        } catch (err) {
          console.error('Sync upload failed for:', file.name);
        }
      }
    }
    
    fetchMedia();
    setUploading(false);
    setError('Sincronización finalizada');
    setTimeout(() => setError(null), 3000);
  };

  const handleSaveEdits = () => {
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
      // We don't save the drawing for now as it's complex to persist canvas data without a real backend
    };
    
    const updatedMedia = { ...selectedMedia, edits };
    setMedia(prev => prev.map(m => 
      m.id === selectedMedia.id ? updatedMedia : m
    ));
    setSelectedMedia(updatedMedia);
    
    setIsEditing(false);
    setError('Cambios guardados localmente');
    setTimeout(() => setError(null), 2000);
  };

  const handleCreateAlbum = () => {
    if (!newAlbumName.trim()) return;
    
    const albumName = newAlbumName.trim();
    if (!customAlbums.includes(albumName)) {
      const updatedAlbums = [...customAlbums, albumName];
      setCustomAlbums(updatedAlbums);
      localStorage.setItem('tg_custom_albums', JSON.stringify(updatedAlbums));
    }
    
    if (selectedMedia) {
      setMedia(prev => prev.map(m => 
        m.id === selectedMedia.id ? { ...m, album: albumName, isPrivate: false } : m
      ));
      setError(`Foto movida al nuevo álbum "${albumName}"`);
    } else {
      setError(`Álbum "${albumName}" creado`);
    }
    
    setNewAlbumName('');
    setShowCreateAlbumModal(false);
    setTimeout(() => setError(null), 2000);
  };

  const handleMoveOrCopy = (albumName: string, mode: 'move' | 'copy') => {
    if (!selectedMedia) return;
    
    if (mode === 'move') {
      setMedia(prev => prev.map(m => 
        m.id === selectedMedia.id ? { ...m, album: albumName, isPrivate: false } : m
      ));
      setError(`Movido a ${albumName}`);
    } else {
      const newId = Math.max(...media.map(m => m.id), 0) + 1;
      const copy = { ...selectedMedia, id: newId, album: albumName, isPrivate: false };
      setMedia(prev => [...prev, copy]);
      setError(`Copiado a ${albumName}`);
    }
    
    setShowAlbumSelector(false);
    setShowAddToMenu(false);
    setTimeout(() => setError(null), 2000);
  };

  const handleMoveToAlbum = (albumName: string) => {
    if (!selectedMedia) return;
    
    setMedia(prev => prev.map(m => 
      m.id === selectedMedia.id ? { ...m, album: albumName, isPrivate: false } : m
    ));
    
    setShowAlbumSelector(false);
    setShowAddToMenu(false);
    setError(`Movido a ${albumName}`);
    setTimeout(() => setError(null), 2000);
  };

  const handleTogglePrivate = () => {
    if (!selectedMedia) return;
    
    if (!privatePassword) {
      setIsSettingPassword(true);
      setShowPasswordModal(true);
      return;
    }
    
    setMedia(prev => prev.map(m => 
      m.id === selectedMedia.id ? { ...m, isPrivate: !m.isPrivate } : m
    ));
    
    setShowAddToMenu(false);
    setSelectedMedia(null); // Close modal after moving
    setError(selectedMedia.isPrivate ? 'Movido a galería pública' : 'Movido a carpeta privada');
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
        setError('Movido a carpeta privada');
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30">
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
              webkitdirectory=""
              directory=""
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
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                  onClick={shareSelected}
                  className="p-2 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  <span className="text-xs font-bold hidden sm:inline">Compartir</span>
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
                    {uploading ? "Subiendo..." : "Subir Archivos"}
                  </h2>
                  <p className="text-slate-400 text-sm">Arrastra o haz clic para subir</p>
                </div>
                {uploading && <div className="absolute bottom-0 left-0 h-1 bg-indigo-500 animate-[shimmer_2s_infinite] w-full" />}
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
                  <div key={album} className="flex items-center gap-2 shrink-0">
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
                    {activeAlbum === album && album !== 'Todos' && album !== 'Privado' && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          shareAlbum();
                        }}
                        className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-full transition-all"
                        title="Compartir álbum"
                      >
                        <Share2 className="w-3 h-3" />
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
                    {item.type === 'photo' ? (
                      <img
                        src={`/api/file/${item.fileId}?t=${botToken}`}
                        alt={item.name}
                        style={item.edits ? {
                          transform: `rotate(${item.edits.rotation}deg) scaleX(${item.edits.flipX ? -1 : 1})`,
                          filter: `brightness(${item.edits.brightness}%) contrast(${item.edits.contrast}%) grayscale(${item.edits.grayscale}%) sepia(${item.edits.sepiaValue + item.edits.warmth}%) blur(${item.edits.blur}px) hue-rotate(${item.edits.hueRotate}deg) invert(${item.edits.invert}%) saturate(${item.edits.saturate}%)`
                        } : {}}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-800/50">
                        <Film className="w-12 h-12 text-slate-600" />
                        <video
                          src={`/api/file/${item.fileId}?t=${botToken}`}
                          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                          muted
                          onMouseOver={(e) => e.currentTarget.play()}
                          onMouseOut={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0;
                          }}
                        />
                      </div>
                    )}

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
                              onClick={() => shareMedia(item)}
                              className="p-2 bg-white/10 hover:bg-emerald-500 text-white rounded-xl backdrop-blur-md transition-all hover:scale-110"
                              title="Compartir"
                            >
                              <Share2 className="w-4 h-4" />
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
                          onClick={() => shareMedia(item)}
                          className="p-2 bg-slate-950/80 text-white rounded-lg backdrop-blur-md border border-white/10"
                        >
                          <Share2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteMedia(item.id)}
                          className="p-2 bg-slate-950/80 text-rose-400 rounded-lg backdrop-blur-md border border-white/10"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    
                    {/* Media Type Icon */}
                    <div className="absolute top-3 left-3 p-2 bg-slate-950/60 backdrop-blur-md rounded-xl border border-white/10 shadow-lg">
                      {item.type === 'photo' ? (
                        <ImageIcon className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Film className="w-4 h-4 text-indigo-400" />
                      )}
                    </div>
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
            <div className="absolute top-0 left-0 right-0 z-30 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
              <button 
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                  } else {
                    setSelectedMedia(null);
                  }
                }}
                className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
              >
                {isEditing ? <X className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
              </button>
              
              <div className="flex items-center gap-4">
                {isEditing && (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setRotation(prev => (prev + 90) % 360)}
                      className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
                      title="Girar"
                    >
                      <RotateCw className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={() => setFlipX(!flipX)}
                      className={cn("p-3 rounded-full transition-all", flipX ? "bg-indigo-600 text-white" : "text-white hover:bg-white/10")}
                      title="Espejo"
                    >
                      <FlipHorizontal className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={resetToOriginal}
                      className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
                      title="Restablecer"
                    >
                      <History className="w-6 h-6" />
                    </button>
                    <button 
                      onMouseDown={() => setIsComparing(true)}
                      onMouseUp={() => setIsComparing(false)}
                      onMouseLeave={() => setIsComparing(false)}
                      onTouchStart={() => setIsComparing(true)}
                      onTouchEnd={() => setIsComparing(false)}
                      className="p-3 text-white hover:bg-white/10 rounded-full transition-all"
                      title="Comparar"
                    >
                      <Columns2 className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={handleSaveEdits}
                      className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-sm transition-all"
                    >
                      Guardar
                    </button>
                  </div>
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
                onDragEnd={(_, info) => {
                  if (info.offset.x > 100) navigateMedia('prev');
                  else if (info.offset.x < -100) navigateMedia('next');
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
                        aspectRatio: cropRatio === '1:1' ? '1/1' : 
                                     cropRatio === '4:3' ? '4/3' : 
                                     cropRatio === '16:9' ? '16/9' : 
                                     cropRatio === 'original' ? `${imageAspectRatio}` : 'auto',
                        maxWidth: '90vw',
                        maxHeight: '65vh',
                      }}
                    >
                      {isEditing && activeEditTab === 'crop' && (
                        <div className="absolute inset-0 z-10 pointer-events-none border-2 border-white/50 shadow-[0_0_0_1000px_rgba(0,0,0,0.5)]">
                          {/* Corner Handles */}
                          <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-white" />
                          <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-white" />
                          <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-white" />
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-white" />
                          {/* Grid Lines */}
                          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-30">
                            <div className="border-r border-white" />
                            <div className="border-r border-white" />
                            <div className="border-b border-white col-span-3" />
                            <div className="border-b border-white col-span-3" />
                          </div>
                        </div>
                      )}
                      <motion.img 
                        drag={isEditing && activeEditTab === 'crop'}
                        dragMomentum={false}
                        onDrag={(_, info) => {
                          setPan(prev => ({ x: prev.x + info.delta.x, y: prev.y + info.delta.y }));
                        }}
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setImageAspectRatio(img.naturalWidth / img.naturalHeight);
                        }}
                        src={`/api/file/${selectedMedia.fileId}?t=${botToken}`} 
                        style={{ 
                          x: pan.x,
                          y: pan.y,
                          rotate: rotation,
                          scale: zoom * (rotation % 180 !== 0 ? Math.min(1, 1/imageAspectRatio, imageAspectRatio) : 1),
                          scaleX: (flipX ? -1 : 1) * zoom * (rotation % 180 !== 0 ? Math.min(1, 1/imageAspectRatio, imageAspectRatio) : 1),
                          filter: isComparing ? 'none' : `brightness(${brightness}%) contrast(${contrast}%) grayscale(${grayscale}%) sepia(${sepiaValue + warmth}%) blur(${blur}px) hue-rotate(${hueRotate}deg) invert(${invert}%) saturate(${saturate}%)`,
                          objectFit: 'contain',
                        }}
                        className={cn(
                          "max-w-full max-h-full transition-all duration-300 select-none shadow-2xl",
                          isEditing && activeEditTab === 'crop' ? "cursor-move" : "pointer-events-none"
                        )}
                        alt={selectedMedia.name}
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
                  </div>
                ) : (
                  <video 
                    src={`/api/file/${selectedMedia.fileId}?t=${botToken}`} 
                    className="max-w-full max-h-full rounded-2xl shadow-2xl"
                    controls
                    autoPlay
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
                      
                      {activeEditTab === 'crop' && (
                        <div className="flex flex-col gap-4 w-full max-w-lg mx-auto py-4 px-8">
                          <div className="flex gap-4 items-center overflow-x-auto no-scrollbar pb-2">
                            <button 
                              onClick={() => setRotation(prev => (prev + 90) % 360)}
                              className="flex flex-col items-center gap-2 group shrink-0"
                            >
                              <div className="w-10 h-10 bg-white/5 group-hover:bg-indigo-600 rounded-xl flex items-center justify-center transition-all border border-white/10">
                                <RotateCw className="w-5 h-5" />
                              </div>
                              <span className="text-[8px] font-bold text-slate-400 uppercase">Girar</span>
                            </button>
                            <div className="h-8 w-px bg-white/10 mx-2 shrink-0" />
                            {[
                              { name: 'Libre', ratio: 'free' },
                              { name: 'Original', ratio: 'original' },
                              { name: '1:1', ratio: '1:1' },
                              { name: '4:3', ratio: '4:3' },
                              { name: '16:9', ratio: '16:9' },
                            ].map(r => (
                              <button 
                                key={r.name} 
                                onClick={() => setCropRatio(r.ratio)}
                                className={cn(
                                  "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shrink-0",
                                  cropRatio === r.ratio ? "bg-indigo-600 text-white" : "bg-white/5 hover:bg-white/10 text-slate-400"
                                )}
                              >
                                {r.name}
                              </button>
                            ))}
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                              <span>Zoom / Escala</span>
                              <span>{Math.round(zoom * 100)}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="0.1" 
                              max="4" 
                              step="0.05"
                              value={zoom}
                              onChange={(e) => setZoom(parseFloat(e.target.value))}
                              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                          </div>
                          
                          <div className="flex justify-center gap-6">
                            <button 
                              onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}
                              className="text-[10px] font-bold text-slate-500 uppercase hover:text-white transition-colors"
                            >
                              Centrar Foto
                            </button>
                            <button 
                              onClick={() => { setRotation(0); setFlipX(false); }}
                              className="text-[10px] font-bold text-slate-500 uppercase hover:text-white transition-colors"
                            >
                              Reiniciar Giro
                            </button>
                          </div>
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
                        <div className="flex gap-4 px-4 py-4">
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
                                <img 
                                  src={`/api/file/${selectedMedia.fileId}?t=${botToken}`} 
                                  className="w-full h-full object-cover opacity-50"
                                  style={{ 
                                    filter: `brightness(${f.filters.brightness}%) contrast(${f.filters.contrast}%) grayscale(${f.filters.grayscale}%) sepia(${f.filters.sepiaValue + f.filters.warmth}%) hue-rotate(${f.filters.hueRotate}deg) saturate(${f.filters.saturate}%)`
                                  }}
                                  alt={f.name}
                                />
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

                  {/* Tabs Navigation */}
                  <div className="flex items-center justify-start md:justify-center gap-8 p-4 border-t border-white/5 overflow-x-auto no-scrollbar touch-pan-x">
                    <div className="flex items-center gap-8 min-w-max mx-auto">
                      <button 
                        onClick={() => setActiveEditTab('suggestions')}
                        className={cn("text-[10px] font-bold uppercase tracking-widest transition-all shrink-0", activeEditTab === 'suggestions' ? "text-white" : "text-slate-500")}
                      >
                        Automático
                      </button>
                      <button 
                        onClick={() => setActiveEditTab('crop')}
                        className={cn("text-[10px] font-bold uppercase tracking-widest transition-all shrink-0", activeEditTab === 'crop' ? "text-white" : "text-slate-500")}
                      >
                        Herramientas
                      </button>
                      <button 
                        onClick={() => setActiveEditTab('filters')}
                        className={cn("text-[10px] font-bold uppercase tracking-widest transition-all shrink-0", activeEditTab === 'filters' ? "text-white" : "text-slate-500")}
                      >
                        Filtros
                      </button>
                      <button 
                        onClick={() => setActiveEditTab('adjust')}
                        className={cn("text-[10px] font-bold uppercase tracking-widest transition-all shrink-0", activeEditTab === 'adjust' ? "text-white" : "text-slate-500")}
                      >
                        Ajustar
                      </button>
                      <button 
                        onClick={() => setActiveEditTab('markup')}
                        className={cn("text-[10px] font-bold uppercase tracking-widest transition-all shrink-0", activeEditTab === 'markup' ? "text-white" : "text-slate-500")}
                      >
                        Dibujar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-around p-4 h-24">
                  <button 
                    onClick={() => shareMedia(selectedMedia)}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <div className="p-2 group-hover:bg-white/10 rounded-full transition-all">
                      <Share2 className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-[10px] font-medium text-slate-400">Compartir</span>
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
                    <input 
                      type="text"
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                      placeholder="55882211"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                      required
                    />
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
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500 font-bold">Opciones de prueba</span></div>
                  </div>

                  <button 
                    type="button"
                    onClick={async () => {
                      if (!botToken || !chatId) return setError('Configura los datos primero');
                      setUploading(true);
                      try {
                        await axios.post('/api/test-connection', {}, { headers: getHeaders() });
                        setError('¡Conexión exitosa! Revisa tu Telegram.');
                        setTimeout(() => setError(null), 5000);
                      } catch (err: any) {
                        setError(err.response?.data?.error || 'Error en la prueba');
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
