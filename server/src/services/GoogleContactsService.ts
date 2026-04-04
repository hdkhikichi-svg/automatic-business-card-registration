import { google } from 'googleapis';
import type { BusinessCard } from '../types/BusinessCard';
import fs from 'fs/promises';
import path from 'path';

export class GoogleContactsService {
  private static SCOPES = ['https://www.googleapis.com/auth/contacts'];
  private static TOKEN_PATH = path.resolve('./token.json');
  private static CREDENTIALS_PATH = path.resolve('./credentials.json');

  private static async getAuthClient() {
    try {
      const content = await fs.readFile(this.CREDENTIALS_PATH, 'utf-8');
      const credentials = JSON.parse(content);
      const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

      try {
        const token = await fs.readFile(this.TOKEN_PATH, 'utf-8');
        oAuth2Client.setCredentials(JSON.parse(token));
      } catch (e) {
        console.warn('No token found. OAuth flow required.');
        throw new Error('AUTH_REQUIRED');
      }

      return oAuth2Client;
    } catch (error: any) {
      if (error.message === 'AUTH_REQUIRED') throw error;
      console.error('Failed to load credentials:', error.message);
      throw new Error('CREDENTIALS_MISSING');
    }
  }

  static async createContact(card: BusinessCard): Promise<void> {
    const auth = await this.getAuthClient();
    const service = google.people({ version: 'v1', auth });

    const fullName = [card.lastName, card.firstName].filter(Boolean).join(' ');
    const phoneticFullName = [card.lastNameKana, card.firstNameKana].filter(Boolean).join(' ');

    const contactBody: any = {
      names: [{
        givenName: fullName || '',
        familyName: card.company || '',
        phoneticGivenName: phoneticFullName || '',
        phoneticFamilyName: card.companyKana || ''
      }],
      organizations: [{
        name: card.company || '',
        department: card.department || '',
        title: card.jobTitle || '',
        type: 'work'
      }],
      phoneNumbers: []
    };

    if (card.email) {
      contactBody.emailAddresses = [{
        value: card.email,
        type: 'work'
      }];
    }

    if (card.phone) {
      contactBody.phoneNumbers.push({ value: card.phone, type: 'work' });
    }
    if (card.mobile) {
      contactBody.phoneNumbers.push({ value: card.mobile, type: 'mobile' });
    }

    try {
      await service.people.createContact({ requestBody: contactBody });
      console.log(`Contact created for ${card.firstName} ${card.lastName}`);
    } catch (error: any) {
      console.error('Google People API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  static async getAuthUrl(): Promise<string> {
    const content = await fs.readFile(this.CREDENTIALS_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    return oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.SCOPES,
      prompt: 'consent'
    });
  }

  static async saveToken(code: string): Promise<void> {
    const content = await fs.readFile(this.CREDENTIALS_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const { tokens } = await oAuth2Client.getToken(code);
    await fs.writeFile(this.TOKEN_PATH, JSON.stringify(tokens));
    console.log('Token stored to', this.TOKEN_PATH);
  }
}
