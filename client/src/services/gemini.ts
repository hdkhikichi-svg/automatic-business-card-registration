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
        let errorMessage = typeof apiErrorDetail === 'string' 
          ? apiErrorDetail 
          : (apiErrorDetail.message || JSON.stringify(apiErrorDetail));
          
        // 英語のエラーメッセージを分かりやすい日本語に変換
        const lowerMsg = errorMessage.toLowerCase();
        if (lowerMsg.includes('high demand') || lowerMsg.includes('429') || lowerMsg.includes('too many requests')) {
          errorMessage = '現在AIサーバーが大変混み合っています。少し時間をおいてから再度お試しください。';
        } else if (lowerMsg.includes('quota') || lowerMsg.includes('limit')) {
          errorMessage = 'AIの利用上限に達しました。しばらく経ってからお試しください。';
        } else if (lowerMsg.includes('api key')) {
          errorMessage = 'システムエラー: AIのAPIキーが無効です。';
        } else if (lowerMsg.includes('request entity too large') || lowerMsg.includes('413')) {
          errorMessage = '写真のデータサイズが大きすぎます。容量を減らして再度お試しください。';
        }

        throw new Error(errorMessage);
      }
      
      throw new Error(`AI解析通信エラー: ${error.message}`);
    }
  }
}
