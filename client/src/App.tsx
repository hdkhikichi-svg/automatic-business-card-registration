import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Play, RefreshCw, CheckCircle, AlertCircle, FileText, Smartphone, BarChart3, Clock, FolderOpen } from 'lucide-react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

interface Stats {
  totalCount: number;
  monthCount: number;
  recent: Array<{
    id: string;
    date: string;
    name: string;
    company: string;
    success: boolean;
  }>;
}

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<string>('待機中');
  const [health, setHealth] = useState<boolean>(false);
  const [scanFolder, setScanFolder] = useState<string>('');
  const [stats, setStats] = useState<Stats>({ totalCount: 0, monthCount: 0, recent: [] });

  useEffect(() => {
    checkHealth();
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      setScanFolder(res.data.scanFolder || './samples/input');
      
      const histRes = await axios.get(`${API_BASE}/history`);
      setStats(histRes.data);
    } catch (e) {
      console.error('Failed to fetch initial data:', e);
    }
  };

  const checkHealth = async () => {
    try {
      await axios.get(`${API_BASE}/health`);
      setHealth(true);
    } catch (e) {
      setHealth(false);
    }
  };

  const handleScan = async () => {
    setIsScanning(true);
    setStatus('スキャン実行中...');
    try {
      const res = await axios.post(`${API_BASE}/scan`);
      if (res.data.success) {
        const results = res.data.results;
        const successCount = results.filter((r: any) => r.status === 'success' || r.status === 'warning').length;
        const errorCount = results.filter((r: any) => r.status === 'error').length;
        
        const allWarnings = results.flatMap((r: any) => r.warnings || []);
        const allErrors = results.filter((r: any) => r.status === 'error').map((r: any) => r.errorMessage || 'エラー');
        
        if (errorCount > 0) {
          setStatus(`エラー: ${errorCount}枚の処理に失敗しました。(${allErrors.join(', ')})`);
        } else {
          let msg = `成功: ${successCount}枚の名刺を処理しました`;
          if (allWarnings.length > 0) {
            msg += ` (⚠️注意: ${allWarnings.join(' / ')})`;
          }
          setStatus(msg);
        }
        
        // Refresh history stats after scan
        fetchSettings();
      }
    } catch (e: any) {
      setStatus(`エラー: ${e.response?.data?.error || e.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAuth = async () => {
    try {
      const res = await axios.get(`${API_BASE}/auth/url`);
      window.open(res.data.url, '_blank');
    } catch (e: any) {
      alert('認証URLの取得に失敗しました: ' + e.message);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await axios.post(`${API_BASE}/settings`, { scanFolder });
      alert('設定を保存しました。');
    } catch (e: any) {
      alert('設定の保存に失敗しました: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const res = await axios.get(`${API_BASE}/browse-folder`);
      if (res.data.path) {
        setScanFolder(res.data.path);
      }
    } catch (e: any) {
      alert('フォルダの選択に失敗しました。サーバーが起動しているか確認してください。');
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <header className="max-w-4xl mx-auto mb-8 flex justify-between items-center text-center">
        <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent italic tracking-tight">
          Automatic Business Card Registration
        </h1>
        <div className={`p-2 rounded-full ${health ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
          <div className="w-2 h-2 rounded-full bg-current" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto">
        <div className="flex gap-4 mb-8">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <Smartphone size={20} /> ダッシュボード
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all ${activeTab === 'settings' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <SettingsIcon size={20} /> 動作設定
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Stats Panel */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-card flex items-center gap-4">
                <div className="p-3 bg-indigo-100 text-indigo-600 rounded-lg">
                  <BarChart3 size={24} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">総スキャン数</p>
                  <p className="text-2xl font-bold text-slate-800">{stats.totalCount}</p>
                </div>
              </div>
              <div className="glass-card flex items-center gap-4">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
                  <Clock size={24} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">今月のスキャン数</p>
                  <p className="text-2xl font-bold text-slate-800">{stats.monthCount}</p>
                </div>
              </div>
            </div>

            <div className="glass-card">
              <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
                <Play className="text-indigo-600" size={24} /> 
                手動スキャン実行
              </h2>
              <p className="text-slate-500 mb-6 text-sm">
                下のボタンをクリックすると、指定フォルダ内にある名刺画像を今すぐスキャンして登録します。
              </p>
              
              <button 
                onClick={handleScan}
                disabled={isScanning}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isScanning ? <RefreshCw className="animate-spin" /> : <Play />}
                {isScanning ? '処理中...' : '今すぐ手動スキャンを実行'}
              </button>

              <div className="mt-6 flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm font-medium">
                <div className={isScanning ? 'text-indigo-600' : (status.includes('注意') ? 'text-yellow-500' : (status.includes('エラー') ? 'text-red-500' : 'text-green-500'))}>
                  {isScanning ? <RefreshCw className="animate-spin" size={18} /> : (status.includes('注意') ? <AlertCircle size={18} /> : <CheckCircle size={18} />)}
                </div>
                <span className="text-slate-700">ステータス: {status}</span>
              </div>
            </div>

            {/* Recent History Panel */}
            <div className="glass-card">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <FileText className="text-indigo-600" size={24} /> 
                最近スキャンした名刺
              </h2>
              {stats.recent.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">まだスキャン履歴がありません</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {stats.recent.map((record) => (
                    <div key={record.id} className="py-3 flex justify-between items-center group">
                      <div>
                        <p className="font-semibold text-slate-800">{record.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{record.company}</p>
                      </div>
                      <div className="text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                        {formatDate(record.date)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* System Info */}
            <div className="glass-card">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <SettingsIcon className="text-indigo-600" size={24} /> 
                システム連携情報
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-sm font-medium">Google 連絡先連携 (People API)</span>
                  <button onClick={handleAuth} className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-md hover:bg-indigo-200 transition-colors font-medium">
                    アカウントを認証する
                  </button>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-sm font-medium">Outlook用 CSV出力機能</span>
                  <span className="text-xs text-slate-500 font-mono italic flex items-center gap-1">
                    <CheckCircle size={14} className="text-green-500" /> 自動有効
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <SettingsIcon className="text-slate-500" size={24} /> 
              各種設定
            </h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-600">対象フォルダ (読み取る名刺画像の場所)</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={scanFolder}
                    onChange={(e) => setScanFolder(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button 
                    onClick={handleBrowseFolder}
                    className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium px-4 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <FolderOpen size={18} />
                    参照...
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-600">自動実行スケジュール (バックグラウンド)</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="time" 
                    defaultValue="10:00"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <div className="text-sm font-medium text-slate-500">毎日実行</div>
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <button onClick={handleSaveSettings} className="btn-primary">
                  変更を保存
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-4xl mx-auto mt-12 text-center text-slate-400 text-xs tracking-widest border-t border-slate-200 pt-6">
        &copy; 2026 Automatic Business Card Registration
      </footer>
    </div>
  );
}

export default App;
