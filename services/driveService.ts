import { getGoogleAccessToken } from './authService';

/**
 * Google Drive API Service using gapi
 * Handles image upload, download, and management
 */

const APP_FOLDER_NAME = 'MY_AI_STUDIO_Images';

// Initialize gapi client
let gapiInitialized = false;
let gapiInitPromise: Promise<void> | null = null;

const initGapi = async (): Promise<void> => {
  if (gapiInitialized) return;
  if (gapiInitPromise) return gapiInitPromise;

  gapiInitPromise = new Promise((resolve, reject) => {
    const checkGapi = () => {
      if (typeof gapi !== 'undefined') {
        gapi.load('client', async () => {
          try {
            await gapi.client.init({
              discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
            });
            gapiInitialized = true;
            console.log('[Drive] gapi initialized');
            resolve();
          } catch (error) {
            console.error('[Drive] Failed to initialize gapi:', error);
            reject(error);
          }
        });
      } else {
        setTimeout(checkGapi, 100);
      }
    };
    checkGapi();
  });

  return gapiInitPromise;
};

// Set access token for gapi
const setGapiToken = () => {
  const token = getGoogleAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please sign in with Google.');
  }
  gapi.client.setToken({ access_token: token });
};

/**
 * Get or create app folder in Google Drive
 */
const getOrCreateAppFolder = async (): Promise<string> => {
  try {
    await initGapi();
    setGapiToken();

    // Search for existing folder
    const response = await gapi.client.drive.files.list({
      q: `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (response.result.files && response.result.files.length > 0) {
      return response.result.files[0].id!;
    }

    // Create new folder if not exists
    const createResponse = await gapi.client.drive.files.create({
      resource: {
        name: APP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    return createResponse.result.id!;
  } catch (error) {
    console.error('Error getting/creating app folder:', error);
    throw new Error('Failed to access Google Drive folder');
  }
};

/**
 * Upload image to Google Drive using gapi
 */
export const uploadImageToDrive = async (
  imageBlob: Blob,
  fileName: string,
  metadata?: {
    prompt?: string;
    settings?: any;
    tags?: string[];
    [key: string]: any;
  }
): Promise<{ fileId: string; fileName: string }> => {
  try {
    console.log('[Drive/gapi] Starting upload:', fileName);
    await initGapi();
    setGapiToken();

    // Get app folder
    const folderId = await getOrCreateAppFolder();

    // Prepare file metadata
    // Store all metadata except large objects like 'settings' (Drive has size limits)
    const { settings, ...cleanMetadata } = metadata || {};

    // Convert all values to strings for properties
    const properties: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(cleanMetadata)) {
      if (value !== undefined && value !== null) {
        properties[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    const fileMetadata = {
      name: fileName,
      parents: [folderId],
      description: metadata?.prompt || '',
      properties: properties,
    };

    // Create form data for multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelimiter = "\r\n--" + boundary + "--";

    // Read blob as base64
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageBlob);
    });

    const base64Data = await base64Promise;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(fileMetadata) +
      delimiter +
      `Content-Type: ${imageBlob.type || 'image/png'}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      base64Data +
      closeDelimiter;

    // Upload using gapi request (not client.drive.files.create for multipart)
    const response = await gapi.client.request({
      path: '/upload/drive/v3/files',
      method: 'POST',
      params: {
        uploadType: 'multipart',
      },
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    console.log('[Drive/gapi] Upload complete:', response.result.name);

    return {
      fileId: response.result.id,
      fileName: response.result.name,
    };
  } catch (error: any) {
    console.error('[Drive/gapi] Upload failed:', error);
    throw new Error(error.result?.error?.message || 'Failed to upload to Google Drive');
  }
};

/**
 * List images from Google Drive app folder
 */
export const listImagesFromDrive = async (): Promise<
  Array<{
    id: string;
    name: string;
    createdTime: string;
    thumbnailLink?: string;
    webViewLink?: string;
    description?: string;
    properties?: any;
  }>
> => {
  try {
    await initGapi();
    setGapiToken();

    // Get app folder
    const folderId = await getOrCreateAppFolder();

    // List files in app folder
    const response = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,createdTime,thumbnailLink,webViewLink,description,properties)',
      orderBy: 'createdTime desc',
      spaces: 'drive',
    });

    return response.result.files || [];
  } catch (error: any) {
    console.error('[Drive/gapi] List failed:', error);
    throw new Error(error.result?.error?.message || 'Failed to list files from Google Drive');
  }
};

/**
 * Download image from Google Drive
 */
export const downloadImageFromDrive = async (fileId: string): Promise<Blob> => {
  try {
    const token = getGoogleAccessToken();
    if (!token) {
      throw new Error('Not authenticated. Please sign in with Google.');
    }

    // Use direct fetch with access token to get blob data
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    return await response.blob();
  } catch (error: any) {
    console.error('[Drive/gapi] Download failed:', error);
    throw new Error(error.message || 'Failed to download from Google Drive');
  }
};

/**
 * Delete image from Google Drive
 */
export const deleteImageFromDrive = async (fileId: string): Promise<void> => {
  try {
    await initGapi();
    setGapiToken();

    await gapi.client.drive.files.delete({
      fileId: fileId,
    });

    console.log('[Drive/gapi] File deleted:', fileId);
  } catch (error: any) {
    console.error('[Drive/gapi] Delete failed:', error);
    throw new Error(error.result?.error?.message || 'Failed to delete from Google Drive');
  }
};

/**
 * Get direct download URL for an image
 */
export const getImageDownloadUrl = async (fileId: string): Promise<string> => {
  const token = getGoogleAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please sign in with Google.');
  }

  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${token}`;
};
