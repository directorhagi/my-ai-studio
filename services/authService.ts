import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from './firebase';

/**
 * Google Drive API Scopes
 * https://developers.google.com/identity/protocols/oauth2/scopes#drive
 */
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // Per-file access to files created or opened by the app
  'https://www.googleapis.com/auth/drive.appdata' // Access to application data folder
];

/**
 * Sign in with Google
 * Includes Google Drive API scopes for future use
 */
export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    if (!isFirebaseConfigured()) {
      throw new Error(
        'Firebase is not configured. Please set up Firebase environment variables.\n\n' +
        'See FIREBASE_SETUP.md for instructions.'
      );
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }

    const provider = new GoogleAuthProvider();

    // Add Google Drive scopes
    GOOGLE_DRIVE_SCOPES.forEach(scope => {
      provider.addScope(scope);
    });

    // Additional parameters for better UX
    provider.setCustomParameters({
      prompt: 'select_account' // Always show account selection
    });

    const result = await signInWithPopup(auth, provider);

    // Get the OAuth access token (needed for Google Drive API)
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken;

    console.log('[Auth] Credential:', credential);
    console.log('[Auth] Access Token:', accessToken ? 'EXISTS (length: ' + accessToken.length + ')' : 'NOT FOUND');

    // Store access token for Google Drive API usage
    if (accessToken) {
      sessionStorage.setItem('google_access_token', accessToken);
      console.log('[Auth] Access token stored in sessionStorage');
    } else {
      console.error('[Auth] No access token received! Drive features will not work.');
    }

    // Verify storage
    const storedToken = sessionStorage.getItem('google_access_token');
    console.log('[Auth] Verification - Token in storage:', storedToken ? 'YES' : 'NO');

    console.log('Successfully signed in:', result.user.email);
    return result.user;
  } catch (error: any) {
    console.error('Error signing in with Google:', error);

    // User-friendly error messages
    if (error.code === 'auth/popup-closed-by-user') {
      throw new Error('로그인 창이 닫혔습니다.');
    } else if (error.code === 'auth/popup-blocked') {
      throw new Error('팝업이 차단되었습니다. 브라우저 설정을 확인해주세요.');
    } else if (error.code === 'auth/cancelled-popup-request') {
      throw new Error('로그인이 취소되었습니다.');
    }

    throw error;
  }
};

/**
 * Sign out the current user
 */
export const signOut = async (): Promise<void> => {
  try {
    const auth = getFirebaseAuth();
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }

    await firebaseSignOut(auth);

    // Clear stored access token
    sessionStorage.removeItem('google_access_token');

    console.log('Successfully signed out');
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
};

/**
 * Get the stored Google access token
 * Used for Google Drive API calls
 */
export const getGoogleAccessToken = (): string | null => {
  return sessionStorage.getItem('google_access_token');
};

/**
 * Subscribe to authentication state changes
 * @param callback Function to call when auth state changes
 * @returns Unsubscribe function
 */
export const onAuthStateChange = (
  callback: (user: User | null) => void
): (() => void) => {
  const auth = getFirebaseAuth();
  if (!auth) {
    console.warn('Firebase Auth is not initialized');
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
};

/**
 * Get current user
 */
export const getCurrentUser = (): User | null => {
  const auth = getFirebaseAuth();
  return auth?.currentUser || null;
};

/**
 * Check if user is signed in
 */
export const isSignedIn = (): boolean => {
  return getCurrentUser() !== null;
};

/**
 * Get user profile information
 */
export const getUserProfile = (user: User | null) => {
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified
  };
};
