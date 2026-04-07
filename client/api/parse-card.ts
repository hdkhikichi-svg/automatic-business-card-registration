import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS support (Vercel automatic for the same domain, but explicit if needed)
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

  // モデル名は既存のコードに従い gemini-2.5-flash を利用（存在しない場合は 1.5-flash 等への調整が必要な可能性あり）
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

  try {
    const response = await axios.post(API_URL, requestBody);
    const outputText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // JSONの抽出
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        return res.status(200).json(result);
      } catch (parseError) {
        return res.status(500).json({ error: 'AIからのJSON解析に失敗しました。', detail: outputText });
      }
    }
    return res.status(500).json({ error: 'AIからの応答に有効なデータが含まれていません。', detail: outputText });
  } catch (error: any) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    const apiErrorDetail = error.response?.data?.error?.message;
    return res.status(500).json({ 
      error: apiErrorDetail ? `AI解析エラー: ${apiErrorDetail}` : `AI解析通信エラー: ${error.message}`
    });
  }
}
