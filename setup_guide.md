# 初期設定ガイド (Setup Guide)

このプロジェクトを動かすには、以下の設定が必要です。

## 1. Google Gemini API キーの取得
1. [Google AI Studio](https://aistudio.google.com/) で API キーを作成します。
2. `server/.env` ファイルを作成し、以下の内容を記述してください：
   ```env
   GEMINI_API_KEY=あなたのAPIキー
   PORT=3001
   ```

## 2. Google People API (連絡先登録) の設定
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成します。
2. 「People API」を有効にします。
3. 「認証情報」から「OAuth 2.0 クライアント ID」を作成します（アプリケーションの種類は「デスクトップ アプリ」または「ウェブ アプリケーション」）。
   - リダイレクト URI に `http://localhost:3001/api/auth/callback` を追加してください。
4. クライアント ID を JSON 形式でダウンロードし、ファイル名を `credentials.json` に変更して `server/` フォルダの直下に配置してください。

## 3. 起動方法

### バックエンド (Server)
```bash
cd server
npm run dev
# (または ts-node src/index.ts)
```

### フロントエンド (Client)
```bash
cd client
npm run dev
```

## 4. 使い方
1. ブラウザで `http://localhost:5173` (Vite のデフォルト) を開きます。
2. ダッシュボードの 「Authorize Account」ボタンを押し、Google アカウントで認証を完了させます（`token.json` が生成されます）。
3. `server/samples/input` フォルダに名刺画像を入れます。
4. 「Run Manual Scan Now」を押すか、設定した時間まで待つと、自動的に Google 連絡先に登録され、`server/samples/output/contacts.csv` が生成されます。
