import fs from 'fs/promises';
import path from 'path';
import { GeminiService } from './GeminiService';
import type { ScanResult, BusinessCard } from '../types/BusinessCard';

export class ScannerService {
  /**
   * 指定されたフォルダ内の画像をスキャンして処理する
   */
  static async scanFolder(
    inputDir: string, 
    successDir: string, 
    errorDir: string,
    onSuccess?: (card: BusinessCard, fileName: string) => Promise<void>
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    try {
      // フォルダが存在しない場合は作成
      await fs.mkdir(successDir, { recursive: true });
      await fs.mkdir(errorDir, { recursive: true });

      const files = await fs.readdir(inputDir);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f));

      for (const fileName of imageFiles) {
        const filePath = path.join(inputDir, fileName);
        
        try {
          const imageBuffer = await fs.readFile(filePath);
          const base64Image = imageBuffer.toString('base64');

          // Gemini で解析
          const cardData = await GeminiService.parseBusinessCard(base64Image);

          // 成功時のコールバック (Google 連絡先登録や CSV 追記)
          if (onSuccess) {
            await onSuccess(cardData, fileName);
          }

          // 成功フォルダへ移動
          await fs.rename(filePath, path.join(successDir, fileName));

          // 警告のチェック
          const warnings: string[] = [];
          if (!cardData.email) warnings.push('メールアドレスが読み取れませんでした');
          if (!cardData.phone && !cardData.mobile) warnings.push('電話番号が読み取れませんでした');

          const status = warnings.length > 0 ? 'warning' : 'success';

          results.push({ fileName, status, cardData, warnings });
        } catch (error: any) {
          console.error(`Error processing ${fileName}:`, error.message);
          // エラーフォルダへ移動
          await fs.rename(filePath, path.join(errorDir, fileName));
          results.push({ fileName, status: 'error', errorMessage: error.message });
        }
      }
    } catch (error: any) {
      console.error('Scan Folder Error:', error.message);
      throw error;
    }

    return results;
  }
}
