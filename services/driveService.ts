import { getGoogleAccessToken } from './authService';

/**
 * Google Drive API Service
 * Handles image upload, download, and management
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// Folder name for storing app images
const APP_FOLDER_NAME = 'MY_AI_STUDIO_Images';

/**
 * Get or create app folder in Google Drive
 */
const getOrCreateAppFolder = async (accessToken: string): Promise<string> => {
  try {
    // Search for existing folder
    const searchResponse = await fetch(
      `${DRIVE_API_BASE}/files?q=name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const searchData = await searchResponse.json();

    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Create new folder if not exists
    const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: APP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    const createData = await createResponse.json();
    return createData.id;
  } catch (error) {
    console.error('Error getting/creating app folder:', error);
    throw new Error('Failed to access Google Drive folder');
  }
};

/**
 * Upload image to Google Drive
 * @param imageBlob - Image blob or file
 * @param fileName - Name for the file
 * @param metadata - Additional metadata (prompt, settings, etc.)
 */
export const uploadImageToDrive = async (
  imageBlob: Blob,
  fileName: string,
  metadata?: {
    prompt?: string;
    settings?: any;
    tags?: string[];
  }
): Promise<{ fileId: string; fileName: string }> => {
  try {
    const accessToken = getGoogleAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated. Please sign in with Google.');
    }

    // Get app folder
    const folderId = await getOrCreateAppFolder(accessToken);

    // Prepare file metadata
    const fileMetadata = {
      name: fileName,
      parents: [folderId],
      description: metadata?.prompt || '',
      properties: metadata || {},
    };

    // Create multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataString = JSON.stringify(fileMetadata);
    const contentType = imageBlob.type || 'image/png';

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
      metadataString +
      delimiter +
      `Content-Type: ${contentType}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      base64Data +
      closeDelimiter;

    const response = await fetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Drive upload error:', error);
      throw new Error(error.error?.message || 'Failed to upload to Google Drive');
    }

    const data = await response.json();
    console.log('Image uploaded to Drive:', data.name);

    return {
      fileId: data.id,
      fileName: data.name,
    };
  } catch (error: any) {
    console.error('Error uploading to Drive:', error);
    throw error;
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
    const accessToken = getGoogleAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated. Please sign in with Google.');
    }

    // Get app folder
    const folderId = await getOrCreateAppFolder(accessToken);

    // List files in app folder
    const response = await fetch(
      `${DRIVE_API_BASE}/files?q='${folderId}' in parents and trashed=false&fields=files(id,name,createdTime,thumbnailLink,webViewLink,description,properties)&orderBy=createdTime desc`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to list files from Google Drive');
    }

    const data = await response.json();
    return data.files || [];
  } catch (error: any) {
    console.error('Error listing from Drive:', error);
    throw error;
  }
};

/**
 * Download image from Google Drive
 * @param fileId - Drive file ID
 */
export const downloadImageFromDrive = async (
  fileId: string
): Promise<Blob> => {
  try {
    const accessToken = getGoogleAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated. Please sign in with Google.');
    }

    const response = await fetch(
      `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to download from Google Drive');
    }

    return await response.blob();
  } catch (error: any) {
    console.error('Error downloading from Drive:', error);
    throw error;
  }
};

/**
 * Delete image from Google Drive
 * @param fileId - Drive file ID
 */
export const deleteImageFromDrive = async (fileId: string): Promise<void> => {
  try {
    const accessToken = getGoogleAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated. Please sign in with Google.');
    }

    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to delete from Google Drive');
    }

    console.log('Image deleted from Drive');
  } catch (error: any) {
    console.error('Error deleting from Drive:', error);
    throw error;
  }
};

/**
 * Get direct download URL for an image
 * @param fileId - Drive file ID
 */
export const getImageDownloadUrl = async (fileId: string): Promise<string> => {
  const accessToken = getGoogleAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated. Please sign in with Google.');
  }

  return `${DRIVE_API_BASE}/files/${fileId}?alt=media&access_token=${accessToken}`;
};
