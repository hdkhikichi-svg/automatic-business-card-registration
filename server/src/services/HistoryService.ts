import fs from 'fs/promises';
import path from 'path';

export interface ScanRecord {
  id: string;
  date: string;
  name: string;
  company: string;
  success: boolean;
}

export class HistoryService {
  private static HISTORY_FILE = path.resolve('history.json');

  private static async getHistory(): Promise<ScanRecord[]> {
    try {
      const data = await fs.readFile(this.HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private static async saveHistory(history: ScanRecord[]): Promise<void> {
    await fs.writeFile(this.HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  }

  static async addRecord(record: Omit<ScanRecord, 'id' | 'date'>): Promise<void> {
    const history = await this.getHistory();
    const newRecord: ScanRecord = {
      ...record,
      id: Math.random().toString(36).substring(2, 11),
      date: new Date().toISOString()
    };
    // Keep the most recent at the top
    history.unshift(newRecord);
    // Prune history to max 1000 records
    if (history.length > 1000) history.length = 1000;
    
    await this.saveHistory(history);
  }

  static async getStats() {
    const history = await this.getHistory();
    const successfulScans = history.filter(r => r.success);
    
    const totalCount = successfulScans.length;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthCount = successfulScans.filter(r => {
      const recordDate = new Date(r.date);
      return recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear;
    }).length;

    const recent = successfulScans.slice(0, 5);

    return { totalCount, monthCount, recent };
  }
}
