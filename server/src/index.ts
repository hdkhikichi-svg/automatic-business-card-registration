import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { GeminiService } from './services/GeminiService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
// Increase limit for base64 images
app.use(express.json({ limit: '50mb' }));

// Serve React static files
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date() });
});

// Proxy endpoint for Gemini parsing
app.post('/api/parse-card', async (req: Request, res: Response) => {
  const { base64Image, mimeType } = req.body;
  
  if (!base64Image) {
    return res.status(400).json({ error: 'base64Image is required' });
  }

  try {
    const cardData = await GeminiService.parseBusinessCard(base64Image);
    res.json(cardData);
  } catch (error: any) {
    console.error('Gemini API Proxy Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// React routing fallback
app.get('*', (req: Request, res: Response) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error('Server error:', err);
  }
});
