import { getGoogleAccessToken } from './authService';

// Declare gapi as a global variable (loaded via script tag in index.html)
declare var gapi: any;

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
  } catch (error: any) {
    console.error('Error getting/creating app folder:', error);
    const errorMessage = error.result?.error?.message || error.message || 'Failed to access Google Drive folder';
    const statusCode = error.status || error.result?.error?.code;

    if (statusCode === 401) {
      throw new Error('401: ' + errorMessage);
    }

    throw new Error(errorMessage);
  }
};

/**
 * Upload image to Google Drive using gapi
 * Also uploads a companion .json file with full metadata
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

    // Prepare file metadata (keep properties minimal)
    const fileMetadata = {
      name: fileName,
      parents: [folderId],
      description: metadata?.prompt || '',
      properties: {
        hasMetadataFile: 'true',
        uploadTime: new Date().toISOString(),
      },
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

    console.log('[Drive/gapi] Image upload complete:', response.result.name);

    // Upload companion metadata JSON file
    if (metadata) {
      const metadataFileName = fileName.replace(/\.(png|jpg|jpeg|webp)$/i, '.json');
      const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });

      const metadataFileMetadata = {
        name: metadataFileName,
        parents: [folderId],
        description: 'Metadata for ' + fileName,
      };

      const metadataBoundary = '-------314159265358979323846';
      const metadataDelimiter = "\r\n--" + metadataBoundary + "\r\n";
      const metadataCloseDelimiter = "\r\n--" + metadataBoundary + "--";

      // Read metadata blob as base64
      const metadataReader = new FileReader();
      const metadataBase64Promise = new Promise<string>((resolve, reject) => {
        metadataReader.onloadend = () => {
          const base64 = (metadataReader.result as string).split(',')[1];
          resolve(base64);
        };
        metadataReader.onerror = reject;
        metadataReader.readAsDataURL(metadataBlob);
      });

      const metadataBase64Data = await metadataBase64Promise;

      const metadataMultipartBody =
        metadataDelimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadataFileMetadata) +
        metadataDelimiter +
        'Content-Type: application/json\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        metadataBase64Data +
        metadataCloseDelimiter;

      await gapi.client.request({
        path: '/upload/drive/v3/files',
        method: 'POST',
        params: {
          uploadType: 'multipart',
        },
        headers: {
          'Content-Type': `multipart/related; boundary=${metadataBoundary}`,
        },
        body: metadataMultipartBody,
      });

      console.log('[Drive/gapi] Metadata file upload complete:', metadataFileName);
    }

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
 * Download metadata JSON file from Google Drive
 */
export const downloadMetadataFromDrive = async (imageFileName: string): Promise<any> => {
  try {
    const token = getGoogleAccessToken();
    if (!token) {
      throw new Error('Not authenticated. Please sign in with Google.');
    }

    await initGapi();
    setGapiToken();

    // Get app folder
    const folderId = await getOrCreateAppFolder();

    // Find the metadata file
    const metadataFileName = imageFileName.replace(/\.(png|jpg|jpeg|webp)$/i, '.json');
    const response = await gapi.client.drive.files.list({
      q: `name='${metadataFileName}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    });

    if (!response.result.files || response.result.files.length === 0) {
      console.log('[Drive] No metadata file found for:', imageFileName);
      return null;
    }

    const metadataFileId = response.result.files[0].id!;

    // Download the metadata file
    const url = `https://www.googleapis.com/drive/v3/files/${metadataFileId}?alt=media`;
    const fetchResponse = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!fetchResponse.ok) {
      throw new Error(`Failed to download metadata: ${fetchResponse.statusText}`);
    }

    const metadataText = await fetchResponse.text();
    return JSON.parse(metadataText);
  } catch (error: any) {
    console.error('[Drive] Failed to download metadata:', error);
    return null; // Return null if metadata not found
  }
};

/**
 * List images from Google Drive app folder
 * Returns only image files (excludes .json metadata files)
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

    // List files in app folder (exclude .json metadata files)
    const response = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed=false and not name contains '.json'`,
      fields: 'files(id,name,createdTime,thumbnailLink,webViewLink,description,properties)',
      orderBy: 'createdTime desc',
      spaces: 'drive',
    });

    return response.result.files || [];
  } catch (error: any) {
    console.error('[Drive/gapi] List failed:', error);
    const errorMessage = error.result?.error?.message || error.message || 'Failed to list files from Google Drive';
    const statusCode = error.status || error.result?.error?.code;

    if (statusCode === 401) {
      throw new Error('401: ' + errorMessage);
    }

    throw new Error(errorMessage);
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
 * Also deletes the companion metadata .json file
 */
export const deleteImageFromDrive = async (fileId: string): Promise<void> => {
  try {
    await initGapi();
    setGapiToken();

    // Get the filename first
    const fileResponse = await gapi.client.drive.files.get({
      fileId: fileId,
      fields: 'name, parents',
    });

    const fileName = fileResponse.result.name;
    const parents = fileResponse.result.parents || [];

    // Delete the image file
    await gapi.client.drive.files.delete({
      fileId: fileId,
    });

    console.log('[Drive/gapi] Image deleted:', fileName);

    // Delete companion metadata file if exists
    if (fileName && parents.length > 0) {
      const metadataFileName = fileName.replace(/\.(png|jpg|jpeg|webp)$/i, '.json');
      const folderId = parents[0];

      const searchResponse = await gapi.client.drive.files.list({
        q: `name='${metadataFileName}' and '${folderId}' in parents and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
      });

      if (searchResponse.result.files && searchResponse.result.files.length > 0) {
        const metadataFileId = searchResponse.result.files[0].id!;
        await gapi.client.drive.files.delete({
          fileId: metadataFileId,
        });
        console.log('[Drive/gapi] Metadata file deleted:', metadataFileName);
      }
    }
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
