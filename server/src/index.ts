import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import { exec } from 'child_process';
import { ScannerService } from './services/ScannerService';
import { GoogleContactsService } from './services/GoogleContactsService';
import { CsvService } from './services/CsvService';
import { HistoryService } from './services/HistoryService';
import type { BusinessCard } from './types/BusinessCard';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 設定（実際にはDBやJSONから読み込む）
let config = {
  scanFolder: path.resolve('./samples/input'),
  successFolder: path.resolve('./samples/output/success'),
  errorFolder: path.resolve('./samples/output/error'),
  csvPath: path.resolve('./samples/output/contacts.csv'),
  schedule: '0 10 * * *', // 毎日 10:00
  isAutoEnabled: true
};

// ヘルスチェック
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date() });
});

// スキャン実行（手動強制実行）
app.post('/api/scan', async (req: Request, res: Response) => {
  console.log('Manual scan triggered');
  try {
    const results = await performScan();
    res.json({ success: true, results });
  } catch (error: any) {
    console.error('Scan Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 設定取得
app.get('/api/settings', (req: Request, res: Response) => {
  res.json(config);
});

// Windows専用: フォルダ参照ダイアログを開いてパスを取得する
app.get('/api/browse-folder', (req: Request, res: Response) => {
  const script = `
    Add-Type -AssemblyName System.windows.forms;
    $f = New-Object System.Windows.Forms.FolderBrowserDialog;
    $f.Description = 'スキャン対象のフォルダを選択してください';
    $f.ShowNewFolderButton = $true;
    if($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }
  `.replace(/\n/g, ' ');

  exec(`powershell.exe -WindowStyle Hidden -STA -NoProfile -Command "${script}"`, (error, stdout, stderr) => {
    if (error) {
       console.error('Browse Folder Error:', error);
       return res.status(500).json({ error: error.message });
    }
    const selectedPath = stdout.trim();
    res.json({ path: selectedPath });
  });
});

// 設定更新
app.post('/api/settings', (req: Request, res: Response) => {
  config = { ...config, ...req.body };
  res.json({ success: true, config });
});

// 履歴・統計取得
app.get('/api/history', async (req: Request, res: Response) => {
  try {
    const stats = await HistoryService.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// OAuth 認証用エンドポイント
app.get('/api/auth/url', async (req: Request, res: Response) => {
  try {
    const url = await GoogleContactsService.getAuthUrl();
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (code) {
    await GoogleContactsService.saveToken(code as string);
    res.send('Authentication successful! You can close this window.');
  } else {
    res.status(400).send('No code provided');
  }
});

async function performScan() {
  console.log('Scanning folder:', config.scanFolder);
  
  return await ScannerService.scanFolder(
    config.scanFolder,
    config.successFolder,
    config.errorFolder,
    async (card: BusinessCard, fileName: string) => {
      // 1. Google 連絡先登録
      try {
        await GoogleContactsService.createContact(card);
      } catch (e: any) {
        console.error(`Google Contact creation failed for ${fileName}:`, e.message);
        throw e;
      }

      // 2. Outlook CSV 追記
      await CsvService.appendToCsv(config.csvPath, card);

      // 3. 履歴に保存
      await HistoryService.addRecord({
        name: [card.lastName, card.firstName].filter(Boolean).join(' '),
        company: card.company || 'Unknown',
        success: true
      });
    }
  );
}

// 定期実行の登録
cron.schedule(config.schedule, () => {
  if (config.isAutoEnabled) {
    console.log('Scheduled scan starting...');
    performScan();
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
