import { getSocketIO } from './socketioClient';

// WebSocketHandler using Socket.IO for progress events
export class WebSocketHandler {
  constructor(baseUrl, userId, progressCallback) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.userId = userId;
    this.progressCallback = progressCallback;
    this.setProgressUpdate = null; // assigned externally
    this._socket = null;
    this._connected = false;
    this._connect();
  }

  async _connect() {
    try {
      const io = await getSocketIO();
      // Namespace optional; if server uses same origin with socketio default path
      this._socket = io(this.baseUrl, {
        transports: ['websocket'],
        query: { userId: String(this.userId) },
        timeout: 15000,
      });
      this._socket.on('connect', () => { this._connected = true; });
      this._socket.on('disconnect', () => { this._connected = false; });
      this._socket.on('connect_error', (err) => { console.warn('[socket] connect_error', err?.message || err); });
      // Listen for server progress events
      this._socket.on('analyze_file_progress', (payload) => {
        if (!payload) return;
        const { fileName, userId, progress, status, error } = payload;
        // Basic validation: must match this user
        if (String(userId) !== String(this.userId)) return;
        const progressUpdate = { fileName, pct: progress, status, error: error || null, message: status };
        // External setter from library AnalyzeFileProgressUpdate
        if (this.setProgressUpdate) {
          try { this.setProgressUpdate(progressUpdate); } catch {}
        }
        // Also direct callback if provided at construction
        if (this.progressCallback) {
          try { this.progressCallback(fileName, this.userId, progressUpdate); } catch {}
        }
      });
    } catch (e) {
      console.warn('[socket] failed to init', e);
    }
  }

  close() {
    try { if (this._socket) { this._socket.disconnect(); } } catch {}
    this._socket = null;
    this._connected = false;
  }
}
