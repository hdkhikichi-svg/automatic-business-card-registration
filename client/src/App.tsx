import React, { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Camera, History, Smartphone, BarChart3, Clock, CheckCircle, AlertCircle, RefreshCw, Download } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import { GeminiService } from './services/gemini';
import { GoogleContactsService } from './services/google';
import { LocalHistoryService } from './services/history';
import type { ScanRecord } from './services/history';

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  errorDetail?: string;
  resultName?: string;
}

function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'settings'>('home');
  const [googleToken, setGoogleToken] = useState<string>('');
  const [stats, setStats] = useState({ totalCount: 0, monthCount: 0, recent: [] as ScanRecord[] });
  
  // バッチスキャン用のキュー
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 初回ロード時に状態を復元 (Googleトークンのみ)
    setGoogleToken(localStorage.getItem('GOOGLE_ACCESS_TOKEN') || '');
    refreshStats();
  }, []);

  const refreshStats = () => {
    setStats(LocalHistoryService.getStats());
  };

  const loginGoogle = useGoogleLogin({
    onSuccess: (codeResponse: any) => {
      setGoogleToken(codeResponse.access_token);
      localStorage.setItem('GOOGLE_ACCESS_TOKEN', codeResponse.access_token);
      alert('Google連絡先と連携されました！');
    },
    scope: 'https://www.googleapis.com/auth/contacts/readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/contacts',
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

  // キューへの追加処理
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
    
    // reset inputs
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (addFileInputRef.current) addFileInputRef.current.value = '';
  };

  const removeQueueItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl); // メモリ解放
      return prev.filter(i => i.id !== id);
    });
  };

  // まとめて一括処理する
  const processQueue = async () => {
    if (!googleToken) {
      alert('Google連携が未設定です。設定タブから連携してください。');
      setActiveTab('settings');
      return;
    }

    setIsProcessingQueue(true);

    try {
      // 未処理・エラーのものだけを対象にする
      const targetItems = queue.filter(item => item.status === 'pending' || item.status === 'error');
      
      for (const item of targetItems) {
        // ステータスを処理中に変更
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', errorDetail: undefined } : q));

        try {
          const { base64, mimeType } = await getBase64(item.file);
          const cardData = await GeminiService.parseBusinessCard(base64, mimeType);
          
          let warnings: string[] = [];
          if (!cardData.email) warnings.push('アドレスなし');
          if (!cardData.phone && !cardData.mobile) warnings.push('電話なし');

          const nameToSave = [cardData.lastName, cardData.firstName].filter(Boolean).join(' ') || '名称不明';
          const companyToSave = cardData.company || '会社不明';

          await GoogleContactsService.createContact(googleToken, cardData);
          
          // 成功記録
          LocalHistoryService.addRecord({
            name: nameToSave,
            company: companyToSave,
            success: true,
            warnings: warnings.length ? warnings : undefined
          });

          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'success', resultName: nameToSave } : q));
        } catch (e: any) {
          // エラー記録
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', errorDetail: e.message } : q));
          LocalHistoryService.addRecord({
            name: 'エラー',
            company: '不明',
            success: false,
            warnings: [e.message]
          });
        }
      }
    } finally {
      setIsProcessingQueue(false);
      refreshStats();
      
      // 全て成功したら自動クリアしたい場合はここに入れる（今回は確認用に残す・または成功のものだけ除外する）
      // 成功したものだけをキューから削除する
      setTimeout(() => {
        setQueue(prev => prev.filter(i => i.status !== 'success'));
      }, 3000);
    }
  };

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

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50 text-slate-900 font-sans overflow-hidden">
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
        
        {/* TAB 1: HOME */}
        {activeTab === 'home' && (
          <div className="flex flex-col h-full animate-in fade-in duration-300">
            <h2 className="text-xl font-bold mb-4 text-slate-800">名刺一括スキャン</h2>
            
            {queue.length === 0 ? (
              // Empty State: 初回の巨大なカメラ起動ボタン
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
              </div>
            ) : (
              // Continuous/Queue State: サムネイル一覧と処理実行ボタン
              <div className="flex-1 flex flex-col pb-6">
                <div className="bg-indigo-50 rounded-2xl p-4 mb-4 flex justify-between items-center border border-indigo-100 shadow-sm">
                  <div>
                    <p className="text-xs text-indigo-600 font-bold mb-1">未登録カード</p>
                    <p className="text-2xl font-bold text-slate-800">{queue.filter(q => q.status === 'pending' || q.status === 'error').length} 枚</p>
                  </div>
                  <button 
                    onClick={processQueue}
                    disabled={isProcessingQueue || queue.filter(q => q.status === 'pending' || q.status === 'error').length === 0}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 transform active:scale-95 transition-all shadow-md"
                  >
                    {isProcessingQueue ? (
                      <><RefreshCw className="animate-spin text-white" size={20} /> 処理中...</>
                    ) : (
                      <>
                        🚀 この分を一括登録する
                      </>
                    )}
                  </button>
                </div>

                {/* Queue Thumbnail List */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 flex-1 content-start auto-rows-max overflow-y-auto">
                  
                  {queue.map((item) => (
                    <div key={item.id} className="relative aspect-[4/3] rounded-xl overflow-hidden shadow-sm border group">
                      <img src={item.previewUrl} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt="card" />
                      
                      {/* Status Overlay */}
                      <div className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity bg-black/40 
                        ${item.status === 'processing' ? 'opacity-100' : 'opacity-0'}
                      `}>
                        <RefreshCw className="text-white animate-spin w-8 h-8 drop-shadow-md" />
                        <span className="text-white font-bold text-xs mt-2">AI解析中</span>
                      </div>

                      {item.status === 'success' && (
                        <div className="absolute inset-0 bg-green-500/80 flex flex-col items-center justify-center">
                          <CheckCircle className="text-white w-8 h-8 drop-shadow-md" />
                          <span className="text-white font-bold text-xs mt-2 px-2 text-center line-clamp-1">{item.resultName}</span>
                        </div>
                      )}

                      {item.status === 'error' && (
                        <div className="absolute inset-0 bg-red-500/80 flex flex-col justify-center items-center p-2 text-center">
                          <AlertCircle className="text-white w-6 h-6 drop-shadow-md mb-1 shrink-0" />
                          <span className="text-white font-bold text-[10px] break-all leading-tight line-clamp-3">{item.errorDetail}</span>
                        </div>
                      )}

                      {/* Remove Button (Only allowed when not processing or success) */}
                      {(item.status === 'pending' || item.status === 'error') && !isProcessingQueue && (
                        <button 
                          onClick={(e) => removeQueueItem(item.id, e)}
                          className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex justify-center items-center hover:bg-red-500 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add More Button inside grid */}
                  {!isProcessingQueue && (
                    <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-slate-50 flex flex-col items-center justify-center cursor-pointer transition-colors group">
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        multiple 
                        onChange={handleQueueFiles} 
                        ref={addFileInputRef}
                        className="hidden" 
                      />
                      <Camera className="text-slate-400 group-hover:text-indigo-400 w-8 h-8 mb-2" />
                      <span className="text-slate-500 group-hover:text-indigo-500 text-xs font-bold px-2 text-center">追加で撮る</span>
                    </label>
                  )}
                </div>
              </div>
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
