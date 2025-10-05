Narrow things down.

## Firebase configuration

Copy `js/firebase-config.example.js` to `js/firebase-config.js` and replace the
placeholder values with your Firebase project's credentials. The generated file
is ignored by Git so that secrets are not committed to the repository. Each
HTML entry point loads `js/firebase-config.js` before the application modules,
making the configuration available as `window.__FIREBASE_CONFIG__`.