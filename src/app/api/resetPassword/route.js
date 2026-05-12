import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { readFileSync } from "fs";
import { join } from "path";

function getAdmin() {
  if (admin.apps.length > 0) return admin;
  const serviceAccount = JSON.parse(
    readFileSync(join(process.cwd(), "scripts", "serviceAccount.json"), "utf8")
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin;
}

export async function POST(request) {
  try {
    const { uid } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: "uid is required" }, { status: 400 });
    }

    const a = getAdmin();

    await a.auth().updateUser(uid, { password: "fct@123" });

    await a.firestore().collection("users").doc(uid).update({
      mustChangePassword: true,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("resetPassword error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
