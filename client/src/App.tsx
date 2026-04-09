import React, { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Camera, History, Smartphone, BarChart3, Clock, CheckCircle, AlertCircle, RefreshCw, Download, X, Trash2, Search, ChevronUp, Edit3, Plus } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import { GeminiService } from './services/gemini';
import { GoogleContactsService } from './services/google';
import { LocalHistoryService } from './services/history';
import type { ScanRecord } from './services/history';
import type { BusinessCard } from './types/BusinessCard';

// キューアイテム: 各名刺の撮影〜登録までの状態を管理
interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  // pending=未解析, scanning=AI解析中, scanned=解析済(結果確認待ち),
  // registering=Google登録中, success=登録成功, error=エラー
  status: 'pending' | 'scanning' | 'scanned' | 'registering' | 'success' | 'error';
  errorDetail?: string;
  errorPhase?: 'scan' | 'register'; // エラーが発生した段階
  resultName?: string;
  cardData?: BusinessCard; // AI解析結果を保持
}

// バッチ処理結果のエラー詳細
interface ErrorDetail {
  name: string;
  company: string;
  errorMessage: string;
  previewUrl?: string;
}

// バッチ処理結果サマリー
interface BatchResult {
  successCount: number;
  errorCount: number;
  errors: ErrorDetail[];
  timestamp: string;
}

// 編集フィールドコンポーネント（解析結果をインラインで修正するため）
const EditField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-2">
    <label className="text-[10px] text-slate-500 font-bold w-12 shrink-0 text-right">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none transition-colors"
    />
  </div>
);

function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'settings'>('home');
  const [googleToken, setGoogleToken] = useState<string>('');
  const [stats, setStats] = useState({ totalCount: 0, monthCount: 0, recent: [] as ScanRecord[] });

  // バッチスキャン用のキュー
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isScanningQueue, setIsScanningQueue] = useState(false);     // AI解析中フラグ
  const [isRegisteringQueue, setIsRegisteringQueue] = useState(false); // Google登録中フラグ
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  // 編集パネルの展開状態
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fabFileInputRef = useRef<HTMLInputElement>(null);

  // 処理中かどうかの派生フラグ
  const isProcessing = isScanningQueue || isRegisteringQueue;

  // 各ステータスのカウント（UI表示用）
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const scannedCount = queue.filter(q => q.status === 'scanned').length;
  const successCount = queue.filter(q => q.status === 'success').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const scanErrorCount = queue.filter(q => q.status === 'error' && q.errorPhase === 'scan').length;

  useEffect(() => {
    // 初回ロード時に状態を復元 (Googleトークンと有効期限)
    const savedToken = localStorage.getItem('GOOGLE_ACCESS_TOKEN');
    const expiresAt = localStorage.getItem('GOOGLE_TOKEN_EXPIRES_AT');
    if (savedToken && expiresAt) {
      if (Date.now() > parseInt(expiresAt, 10)) {
        setGoogleToken('');
        localStorage.removeItem('GOOGLE_ACCESS_TOKEN');
        localStorage.removeItem('GOOGLE_TOKEN_EXPIRES_AT');
      } else {
        setGoogleToken(savedToken);
      }
    }
    refreshStats();
  }, []);

  const refreshStats = () => {
    setStats(LocalHistoryService.getStats());
  };

  const loginGoogle = useGoogleLogin({
    onSuccess: (codeResponse: any) => {
      setGoogleToken(codeResponse.access_token);
      localStorage.setItem('GOOGLE_ACCESS_TOKEN', codeResponse.access_token);
      // トークン有効期限(秒)を取得し、日時(ミリ秒)を保存 (デフォルト1時間)
      const expiresIn = codeResponse.expires_in || 3600;
      const expiresAt = Date.now() + expiresIn * 1000;
      localStorage.setItem('GOOGLE_TOKEN_EXPIRES_AT', expiresAt.toString());
      alert('Google連絡先と連携されました！');
    },
    scope: 'https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/contacts',
    prompt: 'select_account',
    onError: (error: any) => alert('Googleログインに失敗: ' + error)
  });

  const handleSaveSettings = () => {
    alert('設定を保存しました。');
  };

  // 写真ファイルからBase64文字列を作る
  const getBase64 = (file: File): Promise<{ base64: string, mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result?.toString() || '';
        const mimeType = result.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
        // ヘッダを除去
        const base64 = result.replace(/^data:.*,/, '');
        resolve({ base64, mimeType });
      };
      reader.onerror = error => reject(error);
    });
  };

  // キューへの追加処理（撮影/選択した写真をキューに入れる）
  const handleQueueFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newItems: QueueItem[] = Array.from(files).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      previewUrl: URL.createObjectURL(file), // 表示用サムネイル
      status: 'pending'
    }));

    setQueue(prev => [...prev, ...newItems]);

    // input をリセット（同じファイルを再選択可能にする）
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (fabFileInputRef.current) fabFileInputRef.current.value = '';
  };

  // キューからアイテムを削除
  const removeQueueItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl); // メモリ解放
      return prev.filter(i => i.id !== id);
    });
    // 展開中のアイテムが削除された場合は閉じる
    if (expandedItemId === id) setExpandedItemId(null);
  };

  // ============================
  // ステップ1: AI解析のみ実行
  // ============================
  const scanQueue = async () => {
    // スキャン前の期限切れ・未連携チェック
    if (!googleToken) {
      alert('Google連絡先との連携が切れています（または未連携です）。画面から連携を行ってください。');
      return;
    }

    setIsScanningQueue(true);

    // 未解析 または スキャンエラーのものだけを対象にする
    const targetItems = queue.filter(
      item => item.status === 'pending' || (item.status === 'error' && item.errorPhase === 'scan')
    );

    for (const item of targetItems) {
      // ステータスを解析中に変更
      setQueue(prev => prev.map(q =>
        q.id === item.id ? { ...q, status: 'scanning', errorDetail: undefined, errorPhase: undefined } : q
      ));

      try {
        const { base64, mimeType } = await getBase64(item.file);
        const cardData = await GeminiService.parseBusinessCard(base64, mimeType);
        const nameToSave = [cardData.lastName, cardData.firstName].filter(Boolean).join(' ') || '名称不明';

        // 解析成功 → scanned（登録待ち）に
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'scanned', resultName: nameToSave, cardData } : q
        ));
      } catch (e: any) {
        // 解析エラー
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'error', errorDetail: e.message, errorPhase: 'scan' } : q
        ));
      }
    }

    setIsScanningQueue(false);
  };

  // ============================
  // ステップ2: Google連絡先に一括登録
  // ============================
  const registerQueue = async () => {
    if (!googleToken) {
      alert('Google連携が未設定です。設定タブから連携してください。');
      setActiveTab('settings');
      return;
    }

    setIsRegisteringQueue(true);
    let regSuccessCount = 0;
    let regErrorCount = 0;
    const errorDetails: ErrorDetail[] = [];

    // 解析済み または 登録エラーのものだけを対象にする
    const targetItems = queue.filter(
      item => item.status === 'scanned' || (item.status === 'error' && item.errorPhase === 'register')
    );

    for (const item of targetItems) {
      if (!item.cardData) continue;

      // ステータスを登録中に変更
      setQueue(prev => prev.map(q =>
        q.id === item.id ? { ...q, status: 'registering', errorDetail: undefined, errorPhase: undefined } : q
      ));

      try {
        const cardData = item.cardData;
        const warnings: string[] = [];
        if (!cardData.email) warnings.push('アドレスなし');
        if (!cardData.phone && !cardData.mobile) warnings.push('電話なし');

        const nameToSave = [cardData.lastName, cardData.firstName].filter(Boolean).join(' ') || '名称不明';
        const companyToSave = cardData.company || '会社不明';

        // Google People API で連絡先を登録
        await GoogleContactsService.createContact(googleToken, cardData);

        // ローカル履歴に成功記録を追加
        LocalHistoryService.addRecord({
          name: nameToSave,
          company: companyToSave,
          success: true,
          warnings: warnings.length ? warnings : undefined
        });

        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'success', resultName: nameToSave } : q
        ));
        regSuccessCount++;
      } catch (e: any) {
        // 登録エラー
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'error', errorDetail: e.message, errorPhase: 'register' } : q
        ));

        const nameToSave = item.cardData
          ? [item.cardData.lastName, item.cardData.firstName].filter(Boolean).join(' ')
          : 'エラー';

        LocalHistoryService.addRecord({
          name: nameToSave || 'エラー',
          company: item.cardData?.company || '不明',
          success: false,
          warnings: [e.message]
        });

        regErrorCount++;
        errorDetails.push({
          name: nameToSave || 'スキャン失敗',
          company: item.cardData?.company || '不明',
          errorMessage: e.message,
          previewUrl: item.previewUrl,
        });
      }
    }

    setIsRegisteringQueue(false);
    refreshStats();

    // 結果サマリーを保存（ユーザーが消すまで表示）
    setBatchResult({
      successCount: regSuccessCount,
      errorCount: regErrorCount,
      errors: errorDetails,
      timestamp: new Date().toLocaleString('ja-JP'),
    });

    // 成功したものだけをキューから3秒後に削除する
    setTimeout(() => {
      setQueue(prev => prev.filter(i => i.status !== 'success'));
    }, 3000);
  };

  // ============================
  // 解析結果のフィールド編集
  // ============================
  const handleUpdateCardField = (itemId: string, field: keyof BusinessCard, value: string) => {
    setQueue(prev => prev.map(q => {
      if (q.id !== itemId || !q.cardData) return q;
      const updatedCardData = { ...q.cardData, [field]: value };
      // 名前を再計算
      const updatedName = [updatedCardData.lastName, updatedCardData.firstName].filter(Boolean).join(' ') || '名称不明';
      return {
        ...q,
        cardData: updatedCardData,
        resultName: updatedName
      };
    }));
  };

  // CSVエクスポート
  const handleExportCSV = () => {
    const csvContent = LocalHistoryService.exportToCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `scan_history_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 日付フォーマット
  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // キュー全削除
  const clearQueue = () => {
    queue.forEach(item => URL.revokeObjectURL(item.previewUrl));
    setQueue([]);
    setBatchResult(null);
    setExpandedItemId(null);
  };

  return (
    <div className="flex flex-col h-dvh bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white px-4 py-4 md:py-6 shadow-sm border-b border-slate-200 flex justify-between items-center z-10 shrink-0">
        <h1 className="text-lg md:text-2xl font-bold bg-linear-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent italic tracking-tight truncate pr-4">
          Business Card Scanner
        </h1>
        <div className="shrink-0 p-1.5 rounded-full bg-indigo-100 text-indigo-600 shadow-sm text-xs px-3 font-bold">
          PWA
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto p-4 md:p-8 pb-24 scroll-smooth">

        {/* ========================================
            TAB 1: ホーム（連続スキャン → 一括登録）
           ======================================== */}
        {activeTab === 'home' && (
          <div className="flex flex-col h-full animate-in fade-in duration-300">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">名刺一括スキャン</h2>
              {queue.length > 0 && !isProcessing && (
                <button
                  onClick={clearQueue}
                  className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                >
                  <Trash2 size={12} /> すべてクリア
                </button>
              )}
            </div>

            {queue.length === 0 ? (
              /* =====================
                 Empty State: 初回表示
                 ===================== */
              <div className="flex-1 flex flex-col justify-center items-center py-6">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleQueueFiles}
                  ref={fileInputRef}
                  className="hidden"
                  id="cameraInput"
                />
                <label
                  htmlFor="cameraInput"
                  className="group relative flex flex-col items-center justify-center w-64 h-64 md:w-72 md:h-72 bg-indigo-50 border-4 border-dashed rounded-full cursor-pointer transition-all duration-300 shadow-sm border-indigo-400 hover:border-indigo-600 hover:bg-indigo-100"
                >
                  <Camera className="w-20 h-20 text-indigo-500 group-hover:scale-110 transition-transform duration-300" />
                  <span className="mt-6 text-indigo-800 font-bold text-lg text-center">
                    カメラで撮影<br/><span className="text-sm font-normal">または複数枚を選ぶ</span>
                  </span>
                  <div className="absolute inset-0 rounded-full border-4 border-indigo-400 opacity-20 animate-ping" />
                </label>

                {/* 使い方ガイド */}
                <div className="mt-8 text-center space-y-1">
                  <p className="text-xs text-slate-400">📷 連続で撮影 → 🔍 AI解析 → ✅ 確認 → 🚀 一括登録</p>
                </div>
              </div>
            ) : (
              /* ====================================
                 キュー表示: 連続スキャン＆一括登録UI
                 ==================================== */
              <div className="flex-1 flex flex-col pb-6">

                {/* Google連携警告バナー */}
                {!googleToken && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertCircle size={18} className="shrink-0" />
                      <span className="text-[11px] md:text-xs font-bold leading-tight">
                        Google連携が未設定または期限切れです。<br className="md:hidden" />
                        スキャン前に連携してください。
                      </span>
                    </div>
                    <button
                      onClick={() => loginGoogle()}
                      className="shrink-0 text-[10px] md:text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-lg font-bold transition-colors shadow-sm active:scale-95"
                    >
                      連携する
                    </button>
                  </div>
                )}

                {/* バッチ処理結果サマリー（ユーザーが消すまで表示） */}
                {batchResult && !isRegisteringQueue && (
                  <div className="mb-4 rounded-2xl border shadow-sm overflow-hidden">
                    {/* サマリーバー */}
                    <div className={`p-4 flex justify-between items-center ${batchResult.errorCount > 0 ? 'bg-amber-50 border-b border-amber-200' : 'bg-green-50 border-b border-green-200'}`}>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-green-600">
                          <CheckCircle size={16} />
                          <span className="font-bold text-sm">成功 {batchResult.successCount}件</span>
                        </div>
                        {batchResult.errorCount > 0 && (
                          <div className="flex items-center gap-1.5 text-red-600">
                            <AlertCircle size={16} />
                            <span className="font-bold text-sm">エラー {batchResult.errorCount}件</span>
                          </div>
                        )}
                        <span className="text-[10px] text-slate-400">{batchResult.timestamp}</span>
                      </div>
                      <button
                        onClick={() => setBatchResult(null)}
                        className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-white/50 transition-colors"
                        title="結果を閉じる"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* エラー詳細リスト（エラーがある時だけ表示） */}
                    {batchResult.errorCount > 0 && batchResult.errors.length > 0 && (
                      <div className="bg-white divide-y divide-slate-100">
                        <div className="px-4 py-2 bg-red-50">
                          <span className="text-[11px] font-bold text-red-700">⚠ エラーが発生した名刺</span>
                        </div>
                        {batchResult.errors.map((err, idx) => (
                          <div key={idx} className="flex items-start gap-3 p-3">
                            {err.previewUrl && (
                              <img src={err.previewUrl} className="w-14 h-10 object-cover rounded-lg border shrink-0" alt="error card" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-700 truncate">{err.name} / {err.company}</p>
                              <p className="text-[10px] text-red-500 mt-0.5 line-clamp-2">{err.errorMessage}</p>
                            </div>
                            <button
                              onClick={() => {
                                setBatchResult(prev => {
                                  if (!prev) return null;
                                  const newErrors = prev.errors.filter((_, i) => i !== idx);
                                  return { ...prev, errors: newErrors, errorCount: newErrors.length };
                                });
                              }}
                              className="text-slate-300 hover:text-red-500 p-1 shrink-0 transition-colors"
                              title="このエラーを消す"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ステータスバッジ & アクションボタン */}
                <div className="bg-white rounded-2xl p-4 mb-4 border border-slate-200 shadow-sm">
                  {/* ステータスバッジ */}
                  <div className="flex flex-wrap gap-2 mb-3 text-xs">
                    {pendingCount > 0 && (
                      <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-bold">
                        📷 未解析 {pendingCount}枚
                      </span>
                    )}
                    {scanErrorCount > 0 && (
                      <span className="bg-red-100 text-red-600 px-2.5 py-1 rounded-full font-bold">
                        ⚠ 解析エラー {scanErrorCount}枚
                      </span>
                    )}
                    {scannedCount > 0 && (
                      <span className="bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full font-bold">
                        ✅ 解析済 {scannedCount}枚
                      </span>
                    )}
                    {successCount > 0 && (
                      <span className="bg-green-100 text-green-600 px-2.5 py-1 rounded-full font-bold">
                        🎉 登録済 {successCount}枚
                      </span>
                    )}
                    {errorCount > 0 && queue.some(q => q.status === 'error' && q.errorPhase === 'register') && (
                      <span className="bg-red-100 text-red-600 px-2.5 py-1 rounded-full font-bold">
                        ⚠ 登録エラー {queue.filter(q => q.status === 'error' && q.errorPhase === 'register').length}枚
                      </span>
                    )}
                  </div>

                  {/* アクションボタン: 2段階 */}
                  <div className="flex gap-2">
                    {/* ステップ1: AI解析ボタン（未解析があるときのみ） */}
                    {(pendingCount > 0 || scanErrorCount > 0) && (
                      <button
                        onClick={scanQueue}
                        disabled={isProcessing}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                      >
                        {isScanningQueue ? (
                          <><RefreshCw className="animate-spin" size={18} /> AI解析中...</>
                        ) : (
                          <><Search size={18} /> 🔍 AI解析する ({pendingCount + scanErrorCount}枚)</>
                        )}
                      </button>
                    )}

                    {/* ステップ2: 一括登録ボタン（解析済みがあるときのみ） */}
                    {scannedCount > 0 && (
                      <button
                        onClick={registerQueue}
                        disabled={isProcessing}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                      >
                        {isRegisteringQueue ? (
                          <><RefreshCw className="animate-spin" size={18} /> 登録中...</>
                        ) : (
                          <>🚀 一括登録する ({scannedCount}枚)</>
                        )}
                      </button>
                    )}
                  </div>

                  {/* 処理フローガイド（初回のみ） */}
                  {pendingCount > 0 && scannedCount === 0 && !isScanningQueue && (
                    <p className="text-[10px] text-slate-400 mt-2 text-center">
                      まず「AI解析する」→ 解析結果を確認 → 「一括登録する」
                    </p>
                  )}
                </div>

                {/* =====================
                   カードリスト（メイン）
                   ===================== */}
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${
                        item.status === 'success'
                          ? 'border-green-300 bg-green-50/50'
                          : item.status === 'error'
                          ? 'border-red-200 bg-red-50/30'
                          : item.status === 'scanned'
                          ? 'border-blue-200'
                          : 'border-slate-200'
                      }`}
                    >
                      {/* カードのメイン行 */}
                      <div className="flex items-center gap-3 p-3">
                        {/* サムネイル */}
                        <div className="relative w-16 h-12 shrink-0">
                          <img
                            src={item.previewUrl}
                            className="w-full h-full object-cover rounded-lg border"
                            alt="名刺"
                          />
                          {/* スキャン中オーバーレイ */}
                          {item.status === 'scanning' && (
                            <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                              <RefreshCw className="text-white animate-spin" size={16} />
                            </div>
                          )}
                          {/* 登録中オーバーレイ */}
                          {item.status === 'registering' && (
                            <div className="absolute inset-0 bg-indigo-500/40 rounded-lg flex items-center justify-center">
                              <RefreshCw className="text-white animate-spin" size={16} />
                            </div>
                          )}
                        </div>

                        {/* 情報エリア */}
                        <div className="flex-1 min-w-0">
                          {/* 未解析 */}
                          {item.status === 'pending' && (
                            <p className="text-sm text-slate-400 font-medium">📷 未解析</p>
                          )}
                          {/* AI解析中 */}
                          {item.status === 'scanning' && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-blue-600 font-medium">🔍 AI解析中...</span>
                            </div>
                          )}
                          {/* 解析済み・登録中・成功 → 解析結果を表示 */}
                          {(item.status === 'scanned' || item.status === 'registering' || item.status === 'success') && item.cardData && (
                            <>
                              <p className="text-sm font-bold text-slate-800 truncate">
                                {item.resultName}
                              </p>
                              <p className="text-xs text-slate-500 truncate">
                                {item.cardData.company}
                                {item.cardData.department ? ` / ${item.cardData.department}` : ''}
                              </p>
                              {item.cardData.email && (
                                <p className="text-[10px] text-slate-400 truncate">✉ {item.cardData.email}</p>
                              )}
                            </>
                          )}
                          {/* エラー */}
                          {item.status === 'error' && (
                            <>
                              {item.cardData && (
                                <p className="text-xs font-bold text-slate-700 truncate">{item.resultName}</p>
                              )}
                              <p className="text-[10px] text-red-500 font-medium truncate">
                                ⚠ {item.errorPhase === 'scan' ? '解析' : '登録'}エラー: {item.errorDetail}
                              </p>
                            </>
                          )}
                        </div>

                        {/* 右側アクション */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* 成功マーク */}
                          {item.status === 'success' && (
                            <CheckCircle className="text-green-500" size={20} />
                          )}

                          {/* 解析済み → 編集ボタン */}
                          {item.status === 'scanned' && !isProcessing && (
                            <button
                              onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                              className="p-1.5 text-slate-400 hover:text-indigo-500 transition-colors rounded-lg hover:bg-indigo-50"
                              title="解析結果を確認・編集"
                            >
                              {expandedItemId === item.id ? <ChevronUp size={16} /> : <Edit3 size={16} />}
                            </button>
                          )}

                          {/* 削除ボタン（処理中でなく、成功済みでないとき） */}
                          {(item.status === 'pending' || item.status === 'error' || item.status === 'scanned') && !isProcessing && (
                            <button
                              onClick={(e) => removeQueueItem(item.id, e)}
                              className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                              title="削除"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* =====================
                         展開式 編集パネル
                         ===================== */}
                      {expandedItemId === item.id && item.cardData && item.status === 'scanned' && (
                        <div className="border-t border-slate-100 bg-slate-50/80 p-3 space-y-2 animate-in slide-in-from-top duration-200">
                          <p className="text-[10px] text-slate-400 font-bold mb-1">📝 登録前に内容を確認・修正できます</p>
                          <EditField label="姓" value={item.cardData.lastName} onChange={(v) => handleUpdateCardField(item.id, 'lastName', v)} />
                          <EditField label="名" value={item.cardData.firstName} onChange={(v) => handleUpdateCardField(item.id, 'firstName', v)} />
                          <EditField label="会社" value={item.cardData.company} onChange={(v) => handleUpdateCardField(item.id, 'company', v)} />
                          <EditField label="部署" value={item.cardData.department || ''} onChange={(v) => handleUpdateCardField(item.id, 'department', v)} />
                          <EditField label="役職" value={item.cardData.jobTitle || ''} onChange={(v) => handleUpdateCardField(item.id, 'jobTitle', v)} />
                          <EditField label="メール" value={item.cardData.email} onChange={(v) => handleUpdateCardField(item.id, 'email', v)} />
                          <EditField label="電話" value={item.cardData.phone || ''} onChange={(v) => handleUpdateCardField(item.id, 'phone', v)} />
                          <EditField label="携帯" value={item.cardData.mobile || ''} onChange={(v) => handleUpdateCardField(item.id, 'mobile', v)} />
                          <EditField label="FAX" value={item.cardData.fax || ''} onChange={(v) => handleUpdateCardField(item.id, 'fax', v)} />
                          <EditField label="住所" value={item.cardData.address || ''} onChange={(v) => handleUpdateCardField(item.id, 'address', v)} />
                          <EditField label="郵便番号" value={item.cardData.postalCode || ''} onChange={(v) => handleUpdateCardField(item.id, 'postalCode', v)} />
                          <EditField label="Web" value={item.cardData.website || ''} onChange={(v) => handleUpdateCardField(item.id, 'website', v)} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* =================================================
               フローティングアクションボタン（FAB）: 連続撮影用
               ================================================= */}
            {queue.length > 0 && !isProcessing && (
              <label
                className="fixed bottom-24 right-5 z-30 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg shadow-indigo-300/50 cursor-pointer active:scale-90 transition-all"
                title="追加で撮影する"
              >
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleQueueFiles}
                  ref={fabFileInputRef}
                  className="hidden"
                />
                <Plus size={28} strokeWidth={2.5} />
              </label>
            )}
          </div>
        )}

        {/* TAB 2: HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-6 animate-in fade-in duration-300 pb-8">
            <h2 className="text-xl font-bold text-slate-800">ダッシュボード</h2>

            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm flex flex-col justify-center">
                <div className="flex items-center gap-2 text-indigo-600 mb-2">
                  <BarChart3 size={20} />
                  <span className="text-xs md:text-sm font-medium">総スキャン成功数</span>
                </div>
                <p className="text-3xl md:text-4xl font-bold text-slate-800">{stats.totalCount}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm flex flex-col justify-center">
                <div className="flex items-center gap-2 text-blue-600 mb-2">
                  <Clock size={20} />
                  <span className="text-xs md:text-sm font-medium">今月スキャン成功数</span>
                </div>
                <p className="text-3xl md:text-4xl font-bold text-slate-800">{stats.monthCount}</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm mt-6">
              <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <History className="text-indigo-600" size={20} />
                  最近登録した名刺
                </h3>
                <button
                  onClick={handleExportCSV}
                  className="text-xs flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors font-medium border border-slate-200"
                >
                  <Download size={14} /> CSVエクスポート
                </button>
              </div>

              {stats.recent.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center bg-slate-50 rounded-xl">まだ名刺データがありません</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {stats.recent.map((record) => (
                    <div key={record.id} className="py-3 flex justify-between items-center group">
                      <div className="flex-1 min-w-0 pr-4">
                        <p className={`font-bold text-sm md:text-base truncate ${record.success ? 'text-slate-800' : 'text-red-500'}`}>
                          {record.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{record.company}</p>
                      </div>
                      <div className="text-[10px] md:text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100 shrink-0">
                        {formatDate(record.date)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6 animate-in fade-in duration-300 pb-8">
            <h2 className="text-xl font-bold text-slate-800">アプリ設定 (完全ローカル型)</h2>
            <p className="text-xs text-slate-500">
              セキュリティのため、APIキーやトークンはあなたのスマホ内部(ブラウザ)でのみ保存され、外部サーバーには送られません。
            </p>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5">

              <div>
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <Smartphone className="text-indigo-500" size={18} /> API 連携
                </h3>

                <div className="flex justify-between items-center bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 mb-4">
                  <div>
                    <span className="block text-sm font-semibold text-slate-800">Google 連絡先アカウント</span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">名刺データをPeople APIで全自動登録</span>
                  </div>
                  <button
                    onClick={() => loginGoogle()}
                    className={`text-xs text-white px-3 py-2 rounded-lg transition-colors font-medium shadow-sm active:scale-95 ${googleToken ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    {googleToken ? '連携済み (上書き)' : 'Google連携'}
                  </button>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Gemini AI 解析エンジン</label>
                  <p className="text-sm text-slate-700">
                    <span className="inline-flex items-center gap-1.5 text-green-600 font-bold">
                      <CheckCircle size={14} /> サーバー側で安全に管理されています
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-400 mt-2">
                    ※APIキーをバックエンドで管理するように移行したため、ユーザー側でのキー入力は不要になりました。
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <button onClick={handleSaveSettings} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 rounded-xl transition-colors shadow-sm">
                  設定を保存
                </button>
              </div>

            </div>
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 w-full bg-white border-t border-slate-200 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] z-20 pb-safe">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${activeTab === 'home' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Camera size={24} className={activeTab === 'home' ? 'fill-indigo-100' : ''} />
            <span className="text-[10px] font-bold">スキャン</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${activeTab === 'history' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <History size={24} className={activeTab === 'history' ? 'fill-indigo-100' : ''} />
            <span className="text-[10px] font-bold">履歴</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${activeTab === 'settings' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <SettingsIcon size={24} className={activeTab === 'settings' ? 'fill-indigo-100' : ''} />
            <span className="text-[10px] font-bold">設定</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

export default App;
