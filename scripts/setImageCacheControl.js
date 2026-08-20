// One-time fix: existing player photos in Storage (profilepics/*) were
// uploaded without a Cache-Control header, so the browser (and especially
// the iOS/Android "Add to Home Screen" PWA webview) doesn't reliably keep a
// local copy between visits — every full app relaunch can re-fetch them
// over the network instead of loading instantly from cache.
//
// This script sets a long, "immutable" Cache-Control on every file already
// under profilepics/ in Storage, so browsers stop re-downloading photos
// they've already seen. Newly uploaded photos already get this header going
// forward (see uploadPlayerPhoto() in CarromTracker.jsx) — this script just
// backfills the ones uploaded before that change.
//
// It's safe to set this on every existing file: each photo has a unique,
// random filename, and changing a player's photo later always uploads under
// a brand-new filename rather than overwriting the old one — so there's no
// risk of a long cache hiding an updated photo.
//
// Before running: make sure scripts/serviceAccount.json exists (same file
// migrateImagesToStorage.js and createUsers.js use).
//
// Run with:  node scripts/setImageCacheControl.js

const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(__dirname, "serviceAccount.json"));

const STORAGE_BUCKET = "carrom-tracker-550bf.firebasestorage.app";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const bucket = admin.storage().bucket();

async function run() {
  const [files] = await bucket.getFiles({ prefix: "profilepics/" });

  if (!files.length) {
    console.log("No files found under profilepics/ — nothing to do.");
    process.exit(0);
  }

  let updated = 0, failed = 0;

  for (const file of files) {
    try {
      await file.setMetadata({ cacheControl: "public, max-age=31536000, immutable" });
      console.log(`Updated: ${file.name}`);
      updated++;
    } catch (err) {
      console.error(`Failed: ${file.name} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, failed: ${failed}`);
  process.exit(0);
}

run();
