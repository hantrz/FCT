import { NextResponse } from "next/server";
import admin from "firebase-admin";

function getAdmin() {
  if (admin.apps.length > 0) return admin;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin;
}

export async function POST(request) {
  try {
    const { displayName, mobile } = await request.json();

    if (!displayName || !mobile) {
      return NextResponse.json(
        { error: "displayName and mobile are required" },
        { status: 400 }
      );
    }

    const a = getAdmin();

    const userRecord = await a.auth().createUser({
      email: `${mobile}@fnf.app`,
      password: "fct@123",
      displayName,
    });

    await a.firestore().collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      displayName,
      mobile,
      role: "member",
      mustChangePassword: true,
      createdAt: a.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ uid: userRecord.uid });
  } catch (err) {
    console.error("createUser error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
