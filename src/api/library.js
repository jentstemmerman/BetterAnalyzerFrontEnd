// Central library functions imported from external project.
// NOTE: Not yet integrated into UI components. Future calls should import from here.

import axios from 'axios';
import { backendUrl } from '../Constants';
import { WebSocketHandler } from './WebSocketHandler';

const webSocketHandlers = new Map();

// ---- Float16 (half) decoding utilities ----
// Converts a 16-bit half-precision float (Uint16) to a JS Number
function halfToNumber(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7C00) >> 10;
  const f = h & 0x03FF;
  if (e === 0) {
    // Subnormal or zero
    const val = (f ? (f / 0x400) * Math.pow(2, -14) : 0);
    return s ? -val : val;
  } else if (e === 0x1F) {
    // Inf or NaN
    return f ? NaN : (s ? -Infinity : Infinity);
  }
  const val = (1 + f / 0x400) * Math.pow(2, e - 15);
  return s ? -val : val;
}

function isTypedArray(v) {
  return v && typeof v === 'object' && ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function base64ToUint8Array(b64) {
  try {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

// Decode various float16 encodings into a JS number[]
function decodeFloat16Like(input, littleEndian = true) {
  // If already a JS array of numbers, assume decoded
  if (Array.isArray(input) && input.length && typeof input[0] === 'number') return input;
  // If a Uint16Array, convert each element
  if (isTypedArray(input) && input.BYTES_PER_ELEMENT === 2) {
    const out = new Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = halfToNumber(input[i]);
    return out;
  }
  // If a generic TypedArray of bytes or an ArrayBuffer, reinterpret as Uint16
  if (input instanceof ArrayBuffer) {
    const view = new DataView(input);
    const len = input.byteLength >>> 1;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      const u16 = view.getUint16(i * 2, littleEndian);
      out[i] = halfToNumber(u16);
    }
    return out;
  }
  if (isTypedArray(input) && input.BYTES_PER_ELEMENT === 1) {
    const buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    return decodeFloat16Like(buf, littleEndian);
  }
  // If it's a base64 string, decode and then convert
  if (typeof input === 'string' && input.length > 0) {
    const bytes = base64ToUint8Array(input);
    return decodeFloat16Like(bytes, littleEndian);
  }
  return Array.isArray(input) ? input : [];
}

// Normalize server-provided similarities payload entries into { name, simularities: number[] }
function normalizeSimilaritiesPayload(similarities, opts = {}) {
  const littleEndian = opts.littleEndian ?? true; // assume LE by default
  if (!Array.isArray(similarities)) return [];
  const out = [];
  for (const s of similarities) {
    if (!s || typeof s !== 'object') continue;
    const name = s.name ?? s.simularity_file ?? s.label ?? 'similarity';
    // Try common fields for payload
    let data = s.simularities ?? s.values ?? s.scores ?? s.array ?? s.floats;
    const dtype = (s.dtype || s.type || '').toString().toLowerCase();
    // Alternative encodings for float16 we support:
    // - simularities16 / values16 as base64 string or number[] (0..65535)
    // - base64 / dataBase64 / bytes with dtype: 'float16'
    // - typed arrays marshalled by serializers (rare in JSON)
    if (!data) {
      data = s.simularities16 ?? s.values16 ?? s.data16 ?? s.base64 ?? s.dataBase64 ?? s.bytes ?? null;
    }
    let arr = [];
    if (dtype === 'float16' || /16/.test(s?.encoding || '') || 'simularities16' in (s || {}) || 'values16' in (s || {})) {
      // If an array of numbers is given, assume uint16 code points and convert
      if (Array.isArray(data) && data.length && typeof data[0] === 'number') {
        const out = new Array(data.length);
        for (let i = 0; i < data.length; i++) out[i] = halfToNumber(data[i] & 0xFFFF);
        arr = out;
      } else {
        arr = decodeFloat16Like(data, littleEndian);
      }
    } else if (Array.isArray(data) || isTypedArray(data)) {
      // Could already be numeric (float32/float64) or a raw Uint16 without dtype
      if (isTypedArray(data) && data.BYTES_PER_ELEMENT === 2 && !(data instanceof Float32Array) && !(data instanceof Float64Array)) {
        arr = decodeFloat16Like(data, littleEndian);
      } else {
        // Convert TypedArray to normal array for downstream immutability expectations
        arr = Array.from(data);
      }
    } else if (typeof data === 'string') {
      // If dtype suggests float16, decode; otherwise attempt JSON parse fallback
      if (dtype === 'float16' || /^([A-Za-z0-9+/=]+)$/.test(data)) {
        arr = decodeFloat16Like(data, littleEndian);
      } else {
        try { const parsed = JSON.parse(data); arr = Array.isArray(parsed) ? parsed : []; } catch { arr = []; }
      }
    }
    if (arr && arr.length) out.push({ name, simularities: arr });
  }
  return out;
}

export const ServerDirectoryType = {
  LogDirType: 'LogType',
  SignatureDirType: 'SignatureType',
  ModelDirType: 'ModelDirType',
};

export function UploadLogFile(file, userId) {
  if (file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);
    fetch(`${backendUrl}/api/uploadLogFile`, {
      method: 'POST',
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => console.log('File uploaded successfully:', data))
      .catch((error) => console.error('Error uploading file:', error));
  } else {
    console.error('UploadFile No file selected');
  }
}

export const fetchFileLines = async (fileName, userId, startLine, fileSize, numberOfLines, options = {}) => {
  const { similaritiesOnly = false, signal = undefined } = options || {};
  if (startLine >= fileSize) {
    console.error('position >= fileSize', startLine, fileSize);
    return { text: '', start: startLine, size: 0 };
  } else {
    const startTime = Date.now();
    try {
      const response = await axios.get(`${backendUrl}/api/file/getlines/${fileName}`, {
        params: { start: startLine, size: numberOfLines, userId: userId, similaritiesOnly: similaritiesOnly ? 1 : 0 },
        signal: signal,
      });
      const endTime = Date.now();
      //console.log(`fetchFileLines: getlines call took ${endTime - startTime} ms`);
      const { text, start, size } = response.data;
      // Normalize similarities to number[] regardless of transport format (float16/base64/etc.)
      const simularitiesRaw = response.data.simularities ?? response.data.similarities ?? [];
      const normalizedSims = normalizeSimilaritiesPayload(simularitiesRaw, { littleEndian: true });
      // When only similarities are requested, the server may omit text; skip text checks
      if (!similaritiesOnly) {
        let res = response.data;
        const text2 = (res && res.text) ? res.text : '';
        let lines = text2.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        if (lines.length !== numberOfLines)
          console.error(`onRequestLines failed got ${lines.length} instead of ${numberOfLines}`);
      }
      return { text: text, start: start, size: size, simularities: normalizedSims };
    } catch (error) {
      const endTime = Date.now();
      console.log(`fetchFileLines: getlines call failed after ${endTime - startTime} ms`);
      console.error('Error fetching file lines:', error);
      throw error;
    }
  }
};

export const checkAnnotations = async (fileName, userId, annotation_id) => {
  try {
    const response = await axios.get(`${backendUrl}/api/file/checkannotations/${fileName}`, {
      params: { annotation_id: annotation_id, userId: userId },
    });
    return response.data.annotations_exists;
  } catch (error) {
    console.error('Failed to checkAnnotations ', error);
    return null;
  }
};

export const fetchAnnotations = async (fileName, userId, signatureName) => {
  try {
    const response = await fetch(
      `${backendUrl}/api/file/getannotations/${fileName}/${signatureName}?userId=${userId}`
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      console.error('Failed to fetch Annotations:', err);
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return [];
    // Each record is 2 x uint64 (16 bytes): [lineNumber, numLines]
    const view = new BigUint64Array(buffer);
    const annotations = [];
    for (let i = 0; i < view.length; i += 2) {
      annotations.push({
        lineNumber: Number(view[i]),
        lineCount: Number(view[i + 1]),
      });
    }
    return annotations;
  } catch (error) {
    console.error('Failed to fetch Annotations:', error);
    return null;
  }
};

export const getMetadata = async (fileName, userId) => {
  try {
    const response = await axios.get(`${backendUrl}/api/file/meta/${fileName}`, {
      params: { userId: userId },
    });
    return { size: response.data.size, numberOfLines: response.data.numberOfLines };
  } catch (error) {
    console.error('Failed to fetch metadata:', error);
    return null;
  }
};

export const AnalyzeFile = async (fileName, userId, progressUpdate) => {
  try {
    const requestString = `${backendUrl}/api/file/analyze_file/${fileName}`;
    let webSocketHandler = webSocketHandlers.get(fileName);
    if (!webSocketHandler) {
      webSocketHandler = new WebSocketHandler(backendUrl, userId, AnalyzeFileProgressUpdate);
      webSocketHandlers.set(fileName, webSocketHandler);
    }
    if (webSocketHandler) {
      // Provide a bridge so server events push into caller's callback
      webSocketHandler.setProgressUpdate = (update) => {
        if (typeof progressUpdate === 'function') {
          try { progressUpdate(update); } catch {}
        }
      };
    }
    axios.get(requestString, {
      params: { userId: userId, modelDirectory: 'model', tokenDirectory: 'TokenDirectory_1' },
    });
    return null;
  } catch (error) {
    console.error('Failed to start analysis:', error);
    return null;
  }
};

const AnalyzeFileProgressUpdate = async (fileName, userId, progressUpdate) => {
  const handler = webSocketHandlers.get(fileName);
  if (handler && handler.setProgressUpdate) {
    handler.setProgressUpdate(progressUpdate);
  }
};

export const PostProcessLogFiles = async (fileName, userId, similaritythreshold, OnPostProcessLogFilesUpdateHandler) => {
  try {
    const response = await axios.get(`${backendUrl}/api/PostProcessLogFiles`, {
      params: { userId: userId, fileName: fileName, similaritythreshold: similaritythreshold },
    });
    return response.data.started;
  } catch (error) {
    console.error('Failed to PostProcessLogFiles ', error);
    return null;
  }
};

/**
 * Ask the server to re-pack a single signature's similarity data with a new
 * threshold.  The server runs `SimilarityPacker.pack()` in a background thread
 * and emits a `repack_complete` Socket.IO event when done.
 *
 * @param {string} fileName  - The log file name (e.g. "mylog.log")
 * @param {number|string} userId
 * @param {string} signatureName - Signature file name (e.g. "MySignature.dat")
 * @param {number} threshold - Similarity threshold (negative, e.g. -0.5)
 * @returns {Promise<boolean|null>} true if accepted, null on error
 */
export const repackSimilarity = async (fileName, userId, signatureName, threshold) => {
  try {
    const response = await axios.post(`${backendUrl}/api/file/repack_similarity`, {
      fileName,
      userId,
      signatureName,
      threshold,
    });
    return response.data.accepted ?? false;
  } catch (error) {
    console.error('Failed to repackSimilarity:', error);
    return null;
  }
};

export const closeWebSocketHandler = (fileName) => {
  const handler = webSocketHandlers.get(fileName);
  if (handler) {
    handler.close();
    webSocketHandlers.delete(fileName);
  }
};

export const GetServerDirectoryListing = async (userId = 0, path = '', directoryType = ServerDirectoryType.LogDirType) => {
  try {
    const response = await axios.get(`${backendUrl}/api/get_directory_listing`, {
      params: { path, directoryType, userId },
    });
    // Expecting response.data to be an array of { fileName, filePath, isDirectory }
    if (Array.isArray(response.data)) return response.data;
    return [];
  } catch (error) {
    console.error('Failed to fetch directory listing:', error);
    return [];
  }
};

export const GetServerSignatureData = async (userId) => {
  try {
    const response = await axios.get(`${backendUrl}/api/signature_files`, {
      params: { userId: userId },
    });
    const signatureDataList = response.data;
    const signatureNames = signatureDataList.map((file) => file.fileName);
    const signatureFilePaths = signatureDataList.map((file) => file.filePath);
    return { signatureDataList, signatureNames, signatureFilePaths };
  } catch (error) {
    console.error('Failed to fetch signatures:', error);
    return { signatureDataList: [], signatureNames: [], signatureFilePaths: [], selected: [] };
  }
};

export function CreateSignatureOnServer(signature_name, logFileName, path, userId, selectedTextForSignature, callback) {
  if (signature_name && logFileName) {
    const formData = new FormData();
    console.log('CreateSignatureOnServer signature_name ', signature_name);
    formData.append('signature_name', signature_name);
    formData.append('userId', userId);
    formData.append('modelDirectory', 'model');
    formData.append('path', path);
    formData.append('logFileName', logFileName);
    formData.append('selectedTextForSignature', JSON.stringify(selectedTextForSignature));

    fetch(`${backendUrl}/api/createSignatureFile`, {
      method: 'POST',
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => {
        console.log('Signature uploaded successfully:', data);
        if (callback) {
          callback(signature_name, path);
        }
      })
      .catch((error) => {
        console.error('Error uploading Signature:', error);
      });
  } else {
    console.error('UploadFile No Signature selected');
  }
}
