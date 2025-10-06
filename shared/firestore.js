const admin = require('firebase-admin');

let firestore = null;
let firestoreInitFailed = false;

function getFirestore() {
  if (firestore || firestoreInitFailed) {
    return firestore;
  }
  try {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    firestore = admin.firestore();
  } catch (err) {
    firestoreInitFailed = true;
    firestore = null;
    console.error('Failed to initialize Firestore', err);
  }
  return firestore;
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

module.exports = {
  getFirestore,
  serverTimestamp,
  firestoreAdmin: admin
};
