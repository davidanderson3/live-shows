Narrow things down.

## Recipe panel setup

If the Recipes tab shows a CORS error when searching, the frontend could not reach the
Spoonacular proxy. To fix this locally:

1. Create a `.env` file next to `backend/server.js` with your Spoonacular API key, for example `SPOONACULAR_KEY=your_api_key_here`.
2. Restart the development server with `npm start` so the `/api/spoonacular` endpoint becomes available with the proper CORS headers.
3. If you are using a hosted proxy instead of the local server, assign its base URL to `window.apiBaseUrl` before the dashboard initializes.

After applying one of the setups above, reload the page and try the search again.
