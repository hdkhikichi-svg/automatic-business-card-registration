export interface BusinessCard {
  lastName: string;
  lastNameKana?: string;
  firstName: string;
  firstNameKana?: string;
  company: string;
  companyKana?: string;
  department?: string;
  jobTitle?: string;
  email: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  address?: string;
  postalCode?: string;
  country?: string;
  website?: string;
  notes?: string;
}

export interface ScanResult {
  fileName: string;
  status: 'success' | 'failure' | 'error' | 'warning';
  cardData?: BusinessCard;
  errorMessage?: string;
  warnings?: string[];
}
