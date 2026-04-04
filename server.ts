import express, { Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import fs from 'fs';
import FormData from 'form-data';

const app = express();
const PORT = 3000;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Helper to get Telegram config dynamically
const getTelegramConfig = (req: Request) => {
  const tokenHeader = req.headers['x-telegram-token'];
  const chatIdHeader = req.headers['x-telegram-chat-id'];
  
  const token = (Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader as string) || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = (Array.isArray(chatIdHeader) ? chatIdHeader[0] : chatIdHeader as string) || process.env.TELEGRAM_CHAT_ID || '';
  
  return { 
    BOT_TOKEN: token.trim(), 
    CHAT_ID: chatId.trim() 
  };
};

const DB_FILE = path.join(process.cwd(), 'db.json');

// Initialize local DB
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ chats: {} }));
}

function getDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { chats: {} };
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    // Ensure the structure is correct and chats is a plain object
    if (!data || typeof data !== 'object' || !data.chats || typeof data.chats !== 'object' || Array.isArray(data.chats)) {
      return { chats: {} };
    }
    return data;
  } catch (e) {
    console.error('Error reading DB:', e);
    return { chats: {} };
  }
}

function saveToDb(data: any) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// API: Upload media to Telegram
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  const { BOT_TOKEN, CHAT_ID } = getTelegramConfig(req);
  const album = (req.body.album as string) || 'General';
  
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(400).json({ 
        error: 'Telegram configuration missing. Please set your Bot Token and Chat ID in Settings.' 
      });
    }

    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const formData = new FormData();
    formData.append('chat_id', CHAT_ID);
    
    const isVideo = file.mimetype.startsWith('video/');
    const fieldName = isVideo ? 'video' : 'photo';
    
    formData.append(fieldName, file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    const endpoint = isVideo ? '/sendVideo' : '/sendPhoto';
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}${endpoint}`;
    
    const response = await axios.post(telegramUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    const result = response.data.result;
    let fileId = '';
    const messageId = result.message_id;
    
    if (isVideo) {
      fileId = result.video.file_id;
    } else {
      fileId = result.photo[result.photo.length - 1].file_id;
    }

    // Save to local DB scoped by CHAT_ID
    const db = getDb();
    if (!db.chats[CHAT_ID]) db.chats[CHAT_ID] = [];
    
    const newItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      fileId,
      messageId,
      type: isVideo ? 'video' : 'photo',
      name: file.originalname,
      timestamp: new Date().toISOString(),
      album,
    };
    
    db.chats[CHAT_ID].unshift(newItem);
    saveToDb(db);

    res.json({ success: true, media: newItem });
  } catch (error: any) {
    const telegramError = error.response?.data?.description || error.message;
    console.error('Upload error details:', telegramError);
    res.status(500).json({ error: `Telegram Upload Failed: ${telegramError}` });
  }
});

// API: Fetch media list
app.get('/api/media', async (req, res) => {
  try {
    const { CHAT_ID } = getTelegramConfig(req);
    console.log(`[API] Fetching media for Chat ID: ${CHAT_ID}`);
    
    if (!CHAT_ID) {
      return res.json({ media: [] });
    }
    
    const db = getDb();
    const media = db.chats[CHAT_ID] || [];
    console.log(`[API] Found ${media.length} items for Chat ID: ${CHAT_ID}`);
    res.json({ media });
  } catch (error: any) {
    console.error('[API] Error in /api/media:', error.message);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// API: Test Telegram connection
app.post('/api/test-connection', async (req, res) => {
  const { BOT_TOKEN, CHAT_ID } = getTelegramConfig(req);
  
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(telegramUrl, {
      chat_id: CHAT_ID,
      text: '🚀 ¡TeleGallery Conectada! Ahora ya puedes subir tus fotos y videos desde la aplicación.',
    });

    res.json({ success: true });
  } catch (error: any) {
    const telegramError = error.response?.data?.description || error.message;
    console.error('Test connection error:', telegramError);
    
    let userFriendlyError = telegramError;
    if (telegramError.includes('bot can\'t initiate conversation')) {
      userFriendlyError = 'El Bot no tiene permiso para hablarte. Busca a tu Bot en Telegram y pulsa el botón START en el chat privado.';
    } else if (telegramError.includes('Unauthorized')) {
      userFriendlyError = 'Token del Bot inválido. Revísalo en BotFather.';
    } else if (telegramError.includes('chat not found')) {
      userFriendlyError = 'Chat ID no encontrado. Asegúrate de que el ID sea correcto.';
    }

    res.status(500).json({ error: userFriendlyError });
  }
});

// API: Delete media
app.delete('/api/media/:id', async (req, res) => {
  const { BOT_TOKEN, CHAT_ID } = getTelegramConfig(req);
  const { id } = req.params;
  
  try {
    if (!CHAT_ID) return res.status(400).json({ error: 'Chat ID missing' });
    
    const db = getDb();
    if (db.chats[CHAT_ID]) {
      const itemToDelete = db.chats[CHAT_ID].find((item: any) => item.id === parseInt(id));
      
      // Try to delete from Telegram if we have a messageId
      if (itemToDelete && itemToDelete.messageId && BOT_TOKEN) {
        try {
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            chat_id: CHAT_ID,
            message_id: itemToDelete.messageId
          });
        } catch (tgErr: any) {
          console.error('Failed to delete from Telegram:', tgErr.response?.data || tgErr.message);
          // We continue even if Telegram deletion fails (e.g. message too old or already deleted)
        }
      }

      db.chats[CHAT_ID] = db.chats[CHAT_ID].filter((item: any) => item.id !== parseInt(id));
      saveToDb(db);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// API: Bulk update media (e.g., move to album)
app.post('/api/media/bulk-update', async (req, res) => {
  const { CHAT_ID } = getTelegramConfig(req);
  const { ids, album } = req.body;
  
  try {
    if (!CHAT_ID) return res.status(400).json({ error: 'Chat ID missing' });
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'IDs missing' });
    
    const db = getDb();
    if (db.chats[CHAT_ID]) {
      db.chats[CHAT_ID] = db.chats[CHAT_ID].map((item: any) => 
        ids.includes(item.id) ? { ...item, album } : item
      );
      saveToDb(db);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update media' });
  }
});

// API: Proxy Telegram file download
app.get('/api/file/:fileId', async (req, res) => {
  const { BOT_TOKEN } = getTelegramConfig(req);
  
  try {
    if (!BOT_TOKEN) return res.status(400).json({ error: 'Bot token missing' });
    
    const { fileId } = req.params;
    const fileResponse = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const filePath = fileResponse.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
    });

    // Set content type from telegram response
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error: any) {
    console.error('Proxy error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to proxy file from Telegram' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
