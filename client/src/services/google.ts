import axios from 'axios';
import type { BusinessCard } from '../types/BusinessCard';

export class GoogleContactsService {
  static async createContact(accessToken: string, card: BusinessCard): Promise<any> {
    const url = 'https://people.googleapis.com/v1/people:createContact';

    // 1. 基本的な氏名情報
    const names = [];
    if (card.lastName || card.firstName) {
      names.push({
        familyName: card.company || 'Unknown', // 会社名をfamilyNameに入れて並び替えしやすくする既存仕様を踏襲
        givenName: [card.lastName, card.firstName].filter(Boolean).join(' '),
        phoneticFamilyName: card.companyKana || '',
        phoneticGivenName: [card.lastNameKana, card.firstNameKana].filter(Boolean).join(' '),
      });
    }

    // 2. 会社・役職情報
    const organizations = [];
    if (card.company || card.department || card.jobTitle) {
      organizations.push({
        name: card.company,
        phoneticName: card.companyKana,
        department: card.department,
        title: card.jobTitle,
      });
    }

    // 3. メールアドレス
    const emailAddresses = [];
    if (card.email) {
      emailAddresses.push({
        value: card.email,
        type: 'work',
      });
    }

    // 4. 電話番号
    const phoneNumbers = [];
    if (card.phone) {
      phoneNumbers.push({
        value: card.phone,
        type: 'work',
      });
    }
    if (card.mobile) {
      phoneNumbers.push({
        value: card.mobile,
        type: 'mobile',
      });
    }
    if (card.fax) {
      phoneNumbers.push({
        value: card.fax,
        type: 'workFax',
      });
    }

    // 5. 住所
    const addresses = [];
    if (card.address || card.postalCode) {
      addresses.push({
        streetAddress: card.address,
        postalCode: card.postalCode,
        type: 'work',
      });
    }

    // 6. Webサイト
    const urls = [];
    if (card.website) {
      urls.push({
        value: card.website,
        type: 'work',
      });
    }

    const payload = {
      names,
      organizations,
      emailAddresses,
      phoneNumbers,
      addresses,
      urls,
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error: any) {
      console.error('Google Contacts API Error:', error.response?.data || error.message);
      throw new Error('Google Contacts Error: ' + (error.response?.data?.error?.message || error.message));
    }
  }
}
