import fs from 'fs/promises';
import type { BusinessCard } from '../types/BusinessCard';

export class CsvService {
  // Outlook CSV (English Headers for compatibility)
  private static HEADERS = [
    'Last Name', 'First Name', 'Company', 'Department', 'Job Title', 
    'Business Postal Code', 'Business Street', 'Business Phone', 
    'Business Fax', 'Mobile Phone', 'E-mail Address', 'Web Page', 'Notes'
  ].join(',');

  static async appendToCsv(filePath: string, card: BusinessCard): Promise<void> {
    const row = [
      card.lastName,
      card.firstName,
      card.company,
      card.department || '',
      card.jobTitle || '',
      card.postalCode || '',
      `"${card.address || ''}"`, // Address often contains commas
      card.phone || '',
      card.fax || '',
      card.mobile || '',
      card.email,
      card.website || '',
      `"${card.notes || ''}"`
    ].join(',');

    try {
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      
      const content = fileExists ? `\n${row}` : `${this.HEADERS}\n${row}`;
      
      // UTF-8 with BOM (Byte Order Mark) helps Japanese characters in Excel/Outlook
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      if (!fileExists) {
        await fs.writeFile(filePath, Buffer.concat([bom, Buffer.from(content)]));
      } else {
        await fs.appendFile(filePath, content);
      }
    } catch (error: any) {
      console.error('CSV Append Error:', error.message);
      throw error;
    }
  }
}
