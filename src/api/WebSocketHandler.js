// Minimal WebSocketHandler placeholder to satisfy imports.
// Extend with real logic (connection management, message routing) when needed.
export class WebSocketHandler {
  constructor(baseUrl, userId, progressCallback) {
    this.baseUrl = baseUrl;
    this.userId = userId;
    this.progressCallback = progressCallback;
    this.setProgressUpdate = null; // external setter
    // Placeholder: no real websocket connection opened yet
  }
  close() {
    // Close underlying connection if implemented later.
  }
}
