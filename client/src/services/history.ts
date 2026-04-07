import type { ScanResult } from '../types/BusinessCard';

export interface ScanRecord {
  id: string;
  date: string;
  name: string;
  company: string;
  success: boolean;
  warnings?: string[];
}

export class LocalHistoryService {
  private static STORAGE_KEY = 'bizcard_scan_history';

  static getHistory(): ScanRecord[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // Ignore parse errors
    }
    return [];
  }

  static addRecord(record: Omit<ScanRecord, 'id' | 'date'>): void {
    const history = this.getHistory();
    const newRecord: ScanRecord = {
      ...record,
      id: Math.random().toString(36).substring(2, 11),
      date: new Date().toISOString()
    };
    
    // Add to top
    history.unshift(newRecord);
    // Keep max 1000 records
    if (history.length > 1000) history.length = 1000;
    
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
  }

  static getStats() {
    const history = this.getHistory();
    const successfulScans = history.filter(r => r.success);
    
    const totalCount = successfulScans.length;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthCount = successfulScans.filter(r => {
      const recordDate = new Date(r.date);
      return recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear;
    }).length;

    const recent = successfulScans.slice(0, 10); // Show up to 10 in mobile app History tab

    return { totalCount, monthCount, recent, all: history };
  }
  
  static exportToCSV(): string {
    const history = this.getHistory();
    const headers = ['Date', 'Name', 'Company', 'Status', 'Warnings'].join(',');
    const rows = history.map(r => {
      const formattedDate = new Date(r.date).toLocaleString();
      const statusTitle = r.success ? 'Success' : 'Failed';
      const warningText = r.warnings && r.warnings.length > 0 ? r.warnings.join(' / ') : '';
      return `"${formattedDate}","${r.name || ''}","${r.company || ''}","${statusTitle}","${warningText}"`;
    });
    return [headers, ...rows].join('\n');
  }
}
