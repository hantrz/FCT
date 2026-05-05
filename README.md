# Carrom Tracker

বন্ধুদের কেরাম ম্যাচ ট্র্যাকার — Firebase Firestore + Next.js

## ফিচার

- রিয়েলটাইম সিঙ্ক — যেকোনো ডিভাইসে একই ডেটা
- 1v1 ও 2v2 ম্যাচ রেকর্ড
- লিডারবোর্ড — জয়%, জয়, হার
- ম্যাচ ইতিহাস
- ডার্ক মোড সাপোর্ট

---

## ধাপ ১ — Firebase প্রজেক্ট তৈরি করো

1. [console.firebase.google.com](https://console.firebase.google.com) এ যাও
2. **Add project** → নাম দাও (যেমন: `carrom-tracker`) → Create
3. বাম মেনু থেকে **Firestore Database** → **Create database**
4. Mode: **Start in test mode** → Next → Enable

---

## ধাপ ২ — Firebase Config নাও

1. Firebase Console → Project settings (⚙️ আইকন)
2. **Your apps** → Web app আইকন `</>` → নাম দাও → Register
3. নিচের config object দেখতে পাবে, কপি করো

---

## ধাপ ৩ — Local সেটআপ

```bash
# প্রজেক্ট ফোল্ডারে ঢুকো
cd carrom-tracker

# .env.local ফাইল তৈরি করো
cp .env.local.example .env.local
```

`.env.local` ফাইল খুলে Firebase config বসাও:

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=carrom-tracker.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=carrom-tracker
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=carrom-tracker.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc...
```

```bash
# Dependencies install
npm install

# Dev server চালাও
npm run dev
```

Browser-এ `http://localhost:3000` খোলো।

---

## ধাপ ৪ — Vercel-এ Deploy করো

### Option A: GitHub দিয়ে (সহজ)

1. এই প্রজেক্টটা GitHub-এ push করো
2. [vercel.com](https://vercel.com) → **New Project** → GitHub repo import
3. **Environment Variables** সেকশনে `.env.local`-এর সব variable গুলো বসাও
4. **Deploy** চাপো — ৩০ সেকেন্ডে live হবে!

### Option B: CLI দিয়ে

```bash
npm install -g vercel
vercel

# env variables যোগ করো:
vercel env add NEXT_PUBLIC_FIREBASE_API_KEY
# (বাকিগুলোও একইভাবে)

vercel --prod
```

---

## Firestore Rules (Optional — Security)

Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true; // সবাই পড়তে-লিখতে পারবে
    }
  }
}
```

> বন্ধুদের ছোট গ্রুপের জন্য এটাই যথেষ্ট।
> পরে authentication যোগ করতে চাইলে জানাও।

---

## Tech Stack

- **Next.js 14** — React framework
- **Firebase Firestore** — Real-time database
- **Vercel** — Hosting
