import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

/**
 * 指数バックオフ付きのスリープ関数
 * @param attempt リトライ回数（0始まり）
 * @returns 待機時間(ms)のPromise
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 指数バックオフの待機時間を計算（ジッター付き）
 * attempt=0 → 約2秒, attempt=1 → 約4秒, attempt=2 → 約8秒
 */
function getBackoffMs(attempt: number): number {
  const baseMs = 2000; // 2秒から開始
  const maxMs = 15000; // 最大15秒
  const exponentialMs = baseMs * Math.pow(2, attempt);
  // ジッター（±25%のランダム変動）を加えて同時リトライの衝突を回避
  const jitter = exponentialMs * (0.75 + Math.random() * 0.5);
  return Math.min(jitter, maxMs);
}

// リトライ設定
const MAX_RETRIES = 3; // 最大3回リトライ（初回含めず）

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS対応（同ドメインでは自動だが、明示的に記述）
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { base64Image, mimeType = 'image/jpeg' } = req.body;
  const API_KEY = process.env.GEMINI_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'サーバー側でGEMINI_API_KEYが設定されていません。Vercelの環境変数を確認してください。' });
  }

  if (!base64Image) {
    return res.status(400).json({ error: '画像データが不足しています。' });
  }

  // モデル名: gemini-2.5-flash を利用
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
  
  const prompt = `
      Extract business card information from this image.
      Provide the result in JSON format with the following keys:
      - lastName (String)
      - lastNameKana (String, Japanese Katakana)
      - firstName (String)
      - firstNameKana (String, Japanese Katakana)
      - company (String)
      - companyKana (String, Japanese Katakana)
      - department (String)
      - jobTitle (String)
      - email (String)
      - phone (String)
      - mobile (String)
      - fax (String)
      - address (String)
      - postalCode (String)
      - website (String)
      
      Note:
      - Separate lastName and firstName.
      - Predict the correct reading in Katakana for lastNameKana, firstNameKana, and companyKana.
      - IMPORTANT: Do NOT include legal entities like "株式会社", "(株)", "有限会社", "(有)", "Inc.", "Co., Ltd.", etc. in the 'company' and 'companyKana' strings. Only output the actual company name.
      - If multiple numbers exist, prioritize mobile for 'mobile' and office for 'phone'.
      - Return only the JSON content.
  `;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Image
          }
        }
      ]
    }]
  };

  // === 指数バックオフ付きリトライループ ===
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // リトライ時はログを出力
      if (attempt > 0) {
        const waitMs = getBackoffMs(attempt - 1);
        console.log(`[parse-card] リトライ ${attempt}/${MAX_RETRIES} — ${Math.round(waitMs / 1000)}秒待機中...`);
        await sleep(waitMs);
      }

      const response = await axios.post(API_URL, requestBody, {
        timeout: 30000, // 30秒タイムアウト
      });
      const outputText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // JSONの抽出
      const jsonMatch = outputText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          // 成功：リトライ回数もログに記録
          if (attempt > 0) {
            console.log(`[parse-card] ✅ ${attempt}回目のリトライで成功`);
          }
          return res.status(200).json(result);
        } catch (parseError) {
          return res.status(500).json({ error: 'AIからのJSON解析に失敗しました。', detail: outputText });
        }
      }
      return res.status(500).json({ error: 'AIからの応答に有効なデータが含まれていません。', detail: outputText });

    } catch (error: any) {
      lastError = error;
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;

      console.error(`[parse-card] 試行 ${attempt + 1}/${MAX_RETRIES + 1} 失敗:`, {
        status: statusCode,
        message: errorMessage,
      });

      // 429 (レートリミット) または 503 (サービス不可) の場合のみリトライ
      const isRetryable = statusCode === 429 || statusCode === 503;

      if (!isRetryable || attempt === MAX_RETRIES) {
        // リトライ不可 or リトライ回数上限 → エラーを返す
        const detailedError = buildDetailedError(statusCode, errorMessage, attempt);
        return res.status(statusCode || 500).json({ error: detailedError });
      }
      // リトライ可能 → ループの次のイテレーションへ
    }
  }

  // ここには通常到達しないが、安全のため
  const fallbackMsg = lastError?.response?.data?.error?.message || lastError?.message || '不明なエラー';
  return res.status(500).json({ error: `AI解析エラー（リトライ上限超過）: ${fallbackMsg}` });
}

/**
 * ステータスコードとエラーメッセージから、ユーザーに分かりやすいエラー文を生成
 */
function buildDetailedError(statusCode: number | undefined, rawMessage: string, retryCount: number): string {
  const lower = (rawMessage || '').toLowerCase();
  const retryNote = retryCount > 0 ? `（${retryCount}回リトライ後）` : '';

  // 429: レートリミット / クォータ超過
  if (statusCode === 429 || lower.includes('429') || lower.includes('too many requests') || lower.includes('high demand')) {
    if (lower.includes('quota') || lower.includes('limit') || lower.includes('exhausted')) {
      return `APIの利用クォータ（上限）に達しています${retryNote}。Google AI Studio (https://aistudio.google.com/) でクォータ状況を確認し、必要であれば課金プランへのアップグレードをご検討ください。`;
    }
    return `AIサーバーが混雑しており、${MAX_RETRIES}回リトライしましたが接続できませんでした。数分後に再度お試しください。改善しない場合は、Google AI Studio でクォータ状況をご確認ください。`;
  }

  // 503: サービス一時停止
  if (statusCode === 503) {
    return `AIサーバーが一時的に利用できません${retryNote}。しばらく経ってからお試しください。`;
  }

  // 401/403: 認証エラー
  if (statusCode === 401 || statusCode === 403 || lower.includes('api key') || lower.includes('permission') || lower.includes('forbidden')) {
    return `APIキーエラー: キーが無効、期限切れ、またはアクセス権がありません。Vercel環境変数の GEMINI_API_KEY を確認してください。`;
  }

  // 413: リクエストが大きすぎる
  if (statusCode === 413 || lower.includes('too large') || lower.includes('413')) {
    return '画像データが大きすぎます。より小さい画像で再度お試しください。';
  }

  // 404: モデルが見つからない
  if (statusCode === 404 || lower.includes('not found') || lower.includes('404')) {
    return `AIモデル (gemini-2.5-flash) が見つかりません。モデル名が変更・廃止された可能性があります。詳細: ${rawMessage}`;
  }

  // タイムアウト
  if (lower.includes('timeout') || lower.includes('econnaborted')) {
    return `AIサーバーとの通信がタイムアウトしました${retryNote}。ネットワーク接続を確認のうえ、再度お試しください。`;
  }

  // その他
  return `AI解析エラー${retryNote}: ${rawMessage}`;
}
