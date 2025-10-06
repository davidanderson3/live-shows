Narrow things down.

## Recipe panel setup

If the Recipes tab shows a CORS error when searching, the frontend could not reach the
Spoonacular proxy. To fix this locally:

1. Create a `.env` file in the project root (the same folder as `package.json`) with your Spoonacular API key, for example `SPOONACULAR_KEY=your_api_key_here`.
2. Restart the development server with `npm start` so the `/api/spoonacular` endpoint becomes available with the proper CORS headers.
3. If you are using a hosted proxy instead of the local server, assign its base URL to `window.apiBaseUrl` before the dashboard initializes.

After applying one of the setups above, reload the page and try the search again.

## Movies panel setup

If the Movies tab shows a TMDB API key prompt, configure the Cloud Functions
environment (or local environment variables) with a valid key so the TMDB proxy
remains enabled. Run the following command, replacing `YOUR_TMDB_KEY` with your
actual key:

```bash
firebase functions:config:set tmdb.key="YOUR_TMDB_KEY"
```

Deploy the updated configuration or restart your local emulator so the change
takes effect, and reload the dashboard afterwards.
