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
      // Read JWT from sessionStorage (set by AuthContext)
      const token = sessionStorage.getItem('auth_access') || '';
      this._socket = io(this.baseUrl, {
        transports: ['websocket'],
        auth: { token },
        timeout: 15000,
      });
      this._socket.on('connect', () => { this._connected = true; });
      this._socket.on('disconnect', () => { this._connected = false; });
      this._socket.on('connect_error', (err) => { console.warn('[socket] connect_error', err?.message || err); });
      // Listen for server progress events
      this._socket.on('analyze_file_progress', (payload) => {
        if (!payload) return;
        const { fileName, progress, status, error } = payload;
        // Server routes events to user-specific rooms, no client-side userId filtering needed
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

  /** Reconnect with a fresh token (call after token refresh). */
  reconnect() {
    this.close();
    this._connect();
  }

  close() {
    try { if (this._socket) { this._socket.disconnect(); } } catch {}
    this._socket = null;
    this._connected = false;
  }
}
