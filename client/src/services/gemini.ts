import axios from 'axios';
import type { BusinessCard } from '../types/BusinessCard';

export class GeminiService {
  /**
   * 画像データをサーバーサイドAPI (/api/parse-card) に送信し、名刺解析結果を取得します。
   * APIキーはサーバー側の環境変数で管理されるため、フロントエンドには露出しません。
   * サーバー側で指数バックオフ付きリトライが実装されているため、
   * フロントエンド側ではタイムアウトを長めに設定しています。
   */
  static async parseBusinessCard(base64Image: string, mimeType: string = 'image/jpeg'): Promise<BusinessCard> {
    try {
      // サーバー側リトライを考慮し、タイムアウトを90秒に設定
      // （最大3回リトライ × 各30秒タイムアウト + バックオフ待ち時間）
      const response = await axios.post('/api/parse-card', {
        base64Image,
        mimeType
      }, {
        timeout: 90000, // 90秒
      });

      // サーバーレス関数が解析済みのオブジェクトを直接返却する想定
      return response.data;
    } catch (error: any) {
      console.error('Gemini Backend Error:', error.response?.data || error.message);
      
      // === サーバーからのエラーレスポンスがある場合 ===
      const apiErrorDetail = error.response?.data?.error;
      if (apiErrorDetail) {
        // オブジェクトが返ってきた場合に [object Object] になるのを防ぐため、文字列に変換
        const errorMessage = typeof apiErrorDetail === 'string' 
          ? apiErrorDetail 
          : (apiErrorDetail.message || JSON.stringify(apiErrorDetail));
        
        // サーバー側で既に日本語の詳細エラーメッセージを生成済みなので、そのまま表示
        throw new Error(errorMessage);
      }
      
      // === ネットワークエラー等（サーバーに到達できなかった場合）===
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        throw new Error('サーバーとの通信がタイムアウトしました。サーバー側でリトライ中の可能性があります。少し待ってから再度お試しください。');
      }

      if (!error.response) {
        throw new Error('サーバーに接続できませんでした。ネットワーク接続を確認してください。');
      }

      throw new Error(`AI解析通信エラー: ${error.message}`);
    }
  }
}
