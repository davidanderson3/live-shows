# Dashboard

Dashboard is a personal decision-making and entertainment hub that brings movie discovery, live music scouting, and dining ideas into a single web app. The front end is a vanilla JavaScript single-page experience backed by Firebase for auth/persistence and a lightweight Express server for API proxying, caching, and scheduled scripts.

## Table of Contents
- [Feature Tour](#feature-tour)
  - [Movies](#movies)
  - [Live-Music](#live-music)
  - [Restaurants](#restaurants)
  - [Backups, Restore, and Settings Utilities](#backups-restore-and-settings-utilities)
- [Eventbrite integration](#eventbrite-integration)
- [Architecture Overview](#architecture-overview)
- [Configuration & Required Secrets](#configuration--required-secrets)
- [Local Development](#local-development)
- [Testing](#testing)
- [Troubleshooting Checklist](#troubleshooting-checklist)

## Feature Tour

### Movies
The Movies tab is a curated discovery feed for film night:
- **Three collections** – a live "Movie Stream" feed, a "Saved" list you can curate, and a "Watched" archive with ratings.
- **Quality filters** – filter the stream by minimum TMDB rating, vote count, release year window, and genre before requesting more titles.
- **Genre controls** – toggle a single focus genre or exclude any number of genres with pill chips; selections persist between visits and flow into TMDB `without_genres` requests.
- **Progressive discovery** – the client keeps paging through TMDB Discover results until it finds enough titles that meet the quality threshold (`vote_average ≥ 7` and `vote_count ≥ 50` by default).
- **Personal ratings** – mark any movie as Interested, Watched, or Not Interested. Ratings are clamped to 0–10 with half-point granularity.
- **Saved list persistence** – lists and ratings are stored both locally and in Firestore so they follow the authenticated user.
- **TMDB integration** – the UI accepts either a direct TMDB API key or uses the deployed Cloud Function proxy (`/tmdbProxy`) to keep the client keyless.

### Live Music
The Live Music tab now focuses on quick Eventbrite lookups for nearby concerts:
- **Eventbrite personal token input** stored locally so you only paste it once.
- **Location-based search** that requests your current coordinates and looks for music events (category 103) within a 100-mile radius over the next two weeks.
- **Inline status messages** explaining when location sharing is blocked, a token is missing, or no shows were returned.

### Restaurants
Answer the eternal "Where should we eat?" question:
- **City or coordinate search** with optional cuisine filters.
- **Yelp integration** via the Express proxy that accepts a key from request headers, query parameters, or environment variables.
- **Result cards** include ratings, categories, price tier, distance, and direct Yelp links.
- **Caching layer** – identical Yelp queries are cached for 30 minutes to slash API calls.
- **Map-friendly data** – coordinates are included when Yelp provides them, so you can plot results in custom map overlays.

### Backups, Restore, and Settings Utilities
Separate helper pages (`backup.json`, `restore.html`, `settings.html`) provide advanced utilities:
- **Export/import** routines for Firestore collections and locally cached preferences.
- **Environment-specific tweaks** – scripts in `scripts/` automate geolocation imports, travel KML updates, and alert workflows.
- **Monitoring aides** – Node scripts (e.g., `scripts/tempAlert.js`) integrate with Twilio or email to surface anomalies.

### Eventbrite integration
The Eventbrite proxy performs a location-first search so the Discover button can surface concerts without exposing your token to the browser:
1. Calls the Express proxy at `/api/eventbrite` with your latitude, longitude, a default 100-mile radius, and a 14-day window. The proxy converts the radius to Eventbrite's `within` parameter, persists a rolling 24-hour cache keyed by location and start date, and accepts either the server-side token or a manually supplied one.
2. Limits results to Eventbrite's music category (`categories=103`) and sorts events by date before returning them to the client.
3. Normalizes responses into a lightweight shape (name, venue, datetime, ticket URL) that the front end renders directly.

When Eventbrite asks for credentials, supply the **personal OAuth token** (labelled "private token" in their UI) that appears under **Account Settings → Developer → Your personal token**. The classic API key/secret pair does not authorize the Events Search endpoint, so the proxy will return HTTP 401 if you paste those values. You can also set the same personal token in `EVENTBRITE_API_TOKEN`, `EVENTBRITE_OAUTH_TOKEN`, or `EVENTBRITE_TOKEN` on the backend to avoid entering it in the browser.

If no Eventbrite API token is available, Discover prompts for one and never transmits the request without explicit credentials.

### Alternative live music APIs
If you want a broader "what's happening near me" search without providing artist keywords, consider wiring an additional proxy
to one of these location-first providers:

- **SeatGeek Discovery API** – `https://api.seatgeek.com/2/events` accepts `lat`, `lon`, and `range` (miles) parameters so you can request all concerts within a radius. Scope results by `type=concert` and cache responses per rounded coordinate bucket to avoid burning through rate limits.
- **Bandsintown Events API** – `https://rest.bandsintown.com/v4/events` lets you search by `location=LAT,LON` and `radius`. It requires a public app ID and the responses already include venue coordinates, which simplifies distance sorting client-side.

Each provider has distinct authentication and rate limits, so mirror the existing Eventbrite proxy pattern: store tokens server-side, normalize fields to the UI's expected shape (e.g., name, venue, datetime, ticket URL, distance), and short-circuit when no credentials are configured.

## Architecture Overview
- **Front end** – A hand-rolled SPA in vanilla JS, HTML, and CSS. Each tab has a dedicated module under `js/` that owns its DOM bindings, local storage, and network calls.
- **Auth & persistence** – Firebase Auth (Google provider) and Firestore handle user login state plus long-term storage for movies, tab descriptions, and other preferences. Firestore is initialized with persistent caching so the UI stays responsive offline.
- **Server** – `backend/server.js` is an Express app that serves the static bundle, proxies external APIs (Eventbrite, Yelp, Spoonacular), and exposes helper routes for descriptions, saved movies, Plaid item creation, etc. It also normalizes responses and caches expensive calls to protect third-party rate limits.
- **Cloud Functions** – The `functions/` directory mirrors much of the server logic for deployments that rely on Firebase Functions instead of the local Express instance.
- **Shared utilities** – Reusable helpers live under `shared/` (e.g., caching primitives) so both the server and Cloud Functions share a single implementation.
- **Node scripts** – `scripts/` contains operational tooling for geodata imports, monitoring, and static asset generation. They rely on environment variables documented below.

## Configuration & Required Secrets
Create a `.env` in the project root (and optionally `backend/.env`) with the credentials you intend to use. Common settings include:

| Variable | Used By | Purpose |
| --- | --- | --- |
| `PORT` | Express server | Override the default `3003` port. |
| `HOST` | Express server | Bind address; defaults to `0.0.0.0`. |
| `SPOTIFY_CLIENT_ID` | `/api/spotify-client-id` | PKCE client ID for Spotify login. |
| `EVENTBRITE_API_TOKEN`, `EVENTBRITE_OAUTH_TOKEN`, or `EVENTBRITE_TOKEN` | Eventbrite proxy | Eventbrite personal token used for the Events Search API. |
| `SPOONACULAR_KEY` | Spoonacular proxy | API key for recipe search. |
| `YELP_API_KEY` | Restaurants proxy | Yelp Fusion API key if you do not pass one per request. |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid endpoints | Enable financial account linking workflows. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | `/contact` endpoint | Enable contact form email delivery. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `ALERT_PHONE` | `scripts/tempAlert.js` | SMS alerts for monitoring. |

Remember to also configure Firebase (see `firebase.json` and `.firebaserc`) if you deploy hosting or Cloud Functions.

## Local Development
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start the backend**
   ```bash
   npm start
   ```
   This launches the Express server on `http://localhost:3003` and serves `index.html` plus the API proxies.
3. **Set up API keys** – Supply environment variables or enter tokens in the UI (e.g., TMDB, Eventbrite).
4. **Optional Firebase emulators** – If you prefer not to use the production Firestore project during development, configure the Firebase emulator suite and point the app to it.

## Testing
- **Unit/integration tests** – run `npm test` to execute the Vitest suite (covers movie discovery, Eventbrite lookups, etc.).
- **End-to-end tests** – run `npm run e2e` to launch Playwright scenarios when the supporting services are available.

## Troubleshooting Checklist
- **Location sharing disabled** – allow the site to access your location so it can request nearby Eventbrite events. The Discover button will continue to show an error until geolocation succeeds.
- **Empty Discover results** – verify your Eventbrite token is present and that the search radius encompasses nearby venues; the UI will also display the last error returned by the Eventbrite API.
- **`Cannot GET /api/eventbrite`** – point `API_BASE_URL` at the deployed API (`https://narrow-down.web.app/api`) or start the Express server with `npm start` so the Discover tab can reach the Eventbrite search endpoint.
- **Spoonacular quota errors** – the proxy caches responses for six hours; if you keep seeing rate-limit messages clear the cache collection in Firestore or wait for the TTL to expire.
- **Firestore permission denials** – authenticate with Google using the Sign In button; most persistence features require a logged-in user.
- **Yelp proxy failures** – ensure the `x-api-key` header or `YELP_API_KEY` env var is set. The API returns `missing yelp api key` if not.
