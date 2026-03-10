// Global constants placeholder. Adjust backendUrl for environments.
// In Docker, the React app is served by Nginx on the same origin,
// so an empty string (relative URLs) works. During development use the full URL.
export const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
