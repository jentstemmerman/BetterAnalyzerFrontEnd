// Central library functions imported from external project.
// NOTE: Not yet integrated into UI components. Future calls should import from here.

import axios from 'axios';
import { backendUrl } from '../Constants';
import { WebSocketHandler } from './WebSocketHandler';

const webSocketHandlers = new Map();

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
  const { similaritiesOnly = false } = options || {};
  if (startLine >= fileSize) {
    console.error('position >= fileSize', startLine, fileSize);
    return { text: '', start: startLine, size: 0 };
  } else {
    const startTime = Date.now();
    try {
      const response = await axios.get(`${backendUrl}/api/file/getlines/${fileName}`, {
        params: { start: startLine, size: numberOfLines, userId: userId, similaritiesOnly: similaritiesOnly ? 1 : 0 },
      });
      const endTime = Date.now();
      //console.log(`fetchFileLines: getlines call took ${endTime - startTime} ms`);
      const { text, start, size, simularities } = response.data;
      // When only similarities are requested, the server may omit text; skip text checks
      if (!similaritiesOnly) {
        let res = response.data;
        const text2 = (res && res.text) ? res.text : '';
        let lines = text2.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        if (lines.length !== numberOfLines)
          console.error(`onRequestLines failed got ${lines.length} instead of ${numberOfLines}`);
      }
      return { text: text, start: start, size: size, simularities: simularities };
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

export const fetchAnnotations = async (fileName, userId, startLine, numberOfLines, annotation_id) => {
  try {
    const response = await axios.get(`${backendUrl}/api/file/getannotations/${fileName}`, {
      params: { start: startLine, size: numberOfLines, annotation_id: annotation_id, userId: userId },
    });
    return response.data.annotations;
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
