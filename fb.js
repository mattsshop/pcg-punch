// Firebase SDK, loaded straight from Google's CDN (no build step). One place to change the version.
export { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
export {
  getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, orderBy, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch,
  runTransaction, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
export {
  getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
