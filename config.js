// PCG Punch — connection settings.
// Values from Firebase console > Project settings > Your apps > pcg-punch-web.
// These values are not secret (security comes from the rules in firebase/), so it is normal to commit them.
window.PCG_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDHpwkWGCCgBz7_VZt0qo84mkaQdO9B2Wo',
    authDomain: 'pcg-punch.firebaseapp.com',
    projectId: 'pcg-punch',
    storageBucket: 'pcg-punch.firebasestorage.app',
    messagingSenderId: '345564530678',
    appId: '1:345564530678:web:b574fb4a01a0690bc469d7'
  },
  // Web app link of the "PCG Punch Mailer" Apps Script (apps-script/Mailer.gs). Ends in /exec.
  MAILER_URL: 'https://script.google.com/macros/s/AKfycbxPqXYUjjiud4UoCp3_y7GJWvWNZyX477M_mvFmZPEp__CMbSFi79geGxiVN_sGNeCY/exec'
};
