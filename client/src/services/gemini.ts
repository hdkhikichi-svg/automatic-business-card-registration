import axios from 'axios';
import type { BusinessCard } from '../types/BusinessCard';

export class GeminiService {
  static async parseBusinessCard(base64Image: string, mimeType: string = 'image/jpeg'): Promise<BusinessCard> {
    const API_KEY = localStorage.getItem('GEMINI_API_KEY')?.trim() || '';
    
    if (!API_KEY) {
      throw new Error('Gemini APIキーが設定されていません。設定画面から入力してください。');
    }

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
      
      // JSON の抽出 (AI が ```json ... ``` で囲む場合を考慮)
      const jsonMatch = outputText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as BusinessCard;
      }
      throw new Error("Failed to parse JSON from AI response: " + outputText);
    } catch (error: any) {
      console.error('Gemini API Error:', error.response?.data || error.message);
      const apiErrorDetail = error.response?.data?.error?.message;
      if (apiErrorDetail) {
        throw new Error(`AI解析エラー: ${apiErrorDetail}`);
      }
      throw new Error(`AI解析通信エラー: ${error.message}`);
    }
  }
}
