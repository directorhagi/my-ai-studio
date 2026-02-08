import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';

// Firebase configuration from environment variables
const getFirebaseConfig = () => {
  // Try to get from environment variables
  const apiKey = import.meta.env?.VITE_FIREBASE_API_KEY || '';
  const authDomain = import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || '';
  const projectId = import.meta.env?.VITE_FIREBASE_PROJECT_ID || '';
  const storageBucket = import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || '';
  const messagingSenderId = import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
  const appId = import.meta.env?.VITE_FIREBASE_APP_ID || '';

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId
  };
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/**
 * Initialize Firebase
 * Safe to call multiple times - returns existing instance if already initialized
 */
export const initializeFirebase = (): { app: FirebaseApp; auth: Auth } | null => {
  try {
    if (app && auth) {
      return { app, auth };
    }

    const config = getFirebaseConfig();

    // Check if all required config values are present
    if (!config.apiKey || !config.projectId) {
      console.warn(
        'Firebase configuration is incomplete. Please add Firebase environment variables.\n' +
        'Required: VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, etc.'
      );
      return null;
    }

    app = initializeApp(config);
    auth = getAuth(app);

    console.log('Firebase initialized successfully');
    return { app, auth };
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    return null;
  }
};

/**
 * Get Firebase Auth instance
 * Initializes Firebase if not already initialized
 */
export const getFirebaseAuth = (): Auth | null => {
  if (!auth) {
    const result = initializeFirebase();
    return result?.auth || null;
  }
  return auth;
};

/**
 * Check if Firebase is properly configured
 */
export const isFirebaseConfigured = (): boolean => {
  const config = getFirebaseConfig();
  return !!(config.apiKey && config.projectId);
};
