import axios from 'axios';
import type { BusinessCard } from '../types/BusinessCard';

export class GeminiService {
  /**
   * 画像データをサーバーサイドAPI (/api/parse-card) に送信し、名刺解析結果を取得します。
   * APIキーはサーバー側の環境変数で管理されるため、フロントエンドには露出しません。
   */
  static async parseBusinessCard(base64Image: string, mimeType: string = 'image/jpeg'): Promise<BusinessCard> {
    try {
      // 自身がデプロイされているドメインの /api/parse-card エンドポイントを呼び出す
      const response = await axios.post('/api/parse-card', {
        base64Image,
        mimeType
      });

      // サーバーレス関数が解析済みのオブジェクトを直接返却する想定
      return response.data;
    } catch (error: any) {
      console.error('Gemini Backend Error:', error.response?.data || error.message);
      
      const apiErrorDetail = error.response?.data?.error;
      if (apiErrorDetail) {
        // オブジェクトが返ってきた場合に [object Object] になるのを防ぐため、文字列に変換
        const errorMessage = typeof apiErrorDetail === 'string' 
          ? apiErrorDetail 
          : (apiErrorDetail.message || JSON.stringify(apiErrorDetail));
        throw new Error(errorMessage);
      }
      
      throw new Error(`AI解析通信エラー: ${error.message}`);
    }
  }
}
