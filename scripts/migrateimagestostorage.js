// One-time migration: existing players have their photo stored as a raw
// base64 string directly on the Firestore doc (`imageUrl` starts with
// "data:image/..."). That's what was bloating every page load and causing
// the layout-shift/LCP problems in Lighthouse.
//
// This script uploads each of those base64 photos to Firebase Storage and
// replaces the Firestore field with a small public URL instead.
//
// Before running:
//   1. Enable Storage in the Firebase console (Build → Storage → Get started).
//   2. Publish these Storage Rules (console → Storage → Rules):
//        rules_version = '2';
//        service firebase.storage {
//          match /b/{bucket}/o {
//            match /profilepics/{fileName} {
//              allow read: if true;
//              allow write: if request.auth != null;
//            }
//          }
//        }
//   3. Put your bucket name below (same value as NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
//      in .env.local — check the Firebase console → Storage page for the exact name).
//   4. Make sure scripts/serviceAccount.json exists (same file createUsers.js uses).
//
// Run with:  node scripts/migrateImagesToStorage.js

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = require(path.join(__dirname, "serviceAccount.json"));

// TODO: paste your real Storage bucket name here.
const STORAGE_BUCKET = "carrom-tracker-550bf.firebasestorage.app";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function migrate() {
  const snap = await db.collection("players").get();
  const backup = [];
  let migrated = 0, skipped = 0, failed = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const imageUrl = data.imageUrl;

    if (!imageUrl || !imageUrl.startsWith("data:")) {
      skipped++;
      continue;
    }

    try {
      const parsed = parseDataUrl(imageUrl);
      if (!parsed) throw new Error("Could not parse base64 imageUrl");

      backup.push({ id: docSnap.id, name: data.name, oldImageUrl: imageUrl });

      const ext = parsed.contentType === "image/png" ? "png" : "jpg";
      const fileName = `profilepics/${docSnap.id}-${Date.now()}.${ext}`;
      const file = bucket.file(fileName);
      await file.save(parsed.buffer, { metadata: { contentType: parsed.contentType } });

      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
      await docSnap.ref.update({ imageUrl: publicUrl });

      console.log(`Migrated: ${data.name || docSnap.id}`);
      migrated++;
    } catch (err) {
      console.error(`Failed: ${data.name || docSnap.id} — ${err.message}`);
      failed++;
    }
  }

  if (backup.length) {
    const backupPath = path.join(__dirname, `players-imageurl-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\nBackup of old base64 values written to: ${backupPath}`);
  }

  console.log(`\nDone. Migrated: ${migrated}, already fine (skipped): ${skipped}, failed: ${failed}`);
  process.exit(0);
}

migrate();