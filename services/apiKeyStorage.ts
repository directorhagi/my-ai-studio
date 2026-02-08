
/**
 * API Key Storage Manager using localStorage
 * Provides safe and easy access to user's Gemini API key
 */

const API_KEY_STORAGE_KEY = 'gemini_api_key';

/**
 * Check if API key exists in localStorage
 */
export const hasApiKey = (): boolean => {
  try {
    const key = localStorage.getItem(API_KEY_STORAGE_KEY);
    return !!key && key.trim().length > 0;
  } catch (error) {
    console.error('Error checking API key:', error);
    return false;
  }
};

/**
 * Get API key from localStorage
 */
export const getApiKey = (): string | null => {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch (error) {
    console.error('Error retrieving API key:', error);
    return null;
  }
};

/**
 * Save API key to localStorage
 */
export const saveApiKey = (apiKey: string): boolean => {
  try {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
    return true;
  } catch (error) {
    console.error('Error saving API key:', error);
    return false;
  }
};

/**
 * Delete API key from localStorage
 */
export const deleteApiKey = (): boolean => {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Error deleting API key:', error);
    return false;
  }
};

/**
 * Get masked API key for display (shows only first 8 and last 4 characters)
 */
export const getMaskedApiKey = (): string => {
  const apiKey = getApiKey();
  if (!apiKey || apiKey.length < 12) {
    return '••••••••••••';
  }
  const start = apiKey.substring(0, 8);
  const end = apiKey.substring(apiKey.length - 4);
  const middle = '•'.repeat(Math.min(apiKey.length - 12, 20));
  return `${start}${middle}${end}`;
};
