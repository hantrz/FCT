const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccount.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();
const db = admin.firestore();

const users = [
  { displayName: 'Mr. Zed',        mobile: '01719130859' },
  { displayName: 'Masud Rana',     mobile: '01533443548' },
  { displayName: 'Sabiul Haque',   mobile: '01721174028' },
  { displayName: 'Rashedul Islam', mobile: '01744350705' },
  { displayName: 'Imran Hossain',  mobile: '01713225492' },
  { displayName: 'Nazmul Haque',   mobile: '01766796565' },
  { displayName: 'Ashik Rahman',   mobile: '01516509980' },
  { displayName: 'Suvas Munir',    mobile: '01722302673' },
  { displayName: 'Firoz Hassan',    mobile: '01712313295' },
];

const PASSWORD = 'fct@123';

async function createUsers() {
  for (const user of users) {
    const email = `${user.mobile}@fnf.app`;

    try {
      const userRecord = await auth.createUser({
        email,
        password: PASSWORD,
        displayName: user.displayName,
      });

      await db.collection('users').doc(userRecord.uid).set({
        uid: userRecord.uid,
        displayName: user.displayName,
        mobile: user.mobile,
        role: 'member',
        mustChangePassword: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Created: ${user.displayName} - ${userRecord.uid}`);
    } catch (err) {
      console.error(`Failed: ${user.displayName} (${email}) — ${err.message}`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

createUsers();
