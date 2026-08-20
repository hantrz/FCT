import { initializeApp, getApps } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Two fixes for the "Connecting... / 0 players / 0 matches" delay on first
// load, especially on restrictive mobile networks:
//
// 1. experimentalAutoDetectLongPolling — Firestore's realtime listeners use
//    a persistent WebChannel connection. Some mobile carriers/networks
//    don't negotiate that connection type cleanly, causing the client to
//    retry for a long time before falling back. This flag lets the SDK
//    probe the network and pick the connection method that actually works,
//    instead of assuming one.
//
// 2. persistentLocalCache — caches every synced document in IndexedDB on
//    the device. After the first successful load, reopening the app reads
//    straight from this local cache (near-instant, no network wait) while
//    Firestore syncs in the background and pulls down only what changed
//    since last time — not the whole dataset again. persistentMultipleTabManager
//    lets multiple open tabs/PWA windows share one local cache safely.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const auth = getAuth(app);
export const storage = getStorage(app);
