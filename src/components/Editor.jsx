import React, { useRef, useEffect, useState, useCallback } from 'react';
import MonacoEditor, { useMonaco } from '@monaco-editor/react';

// Virtualized editor props (optional):
// virtualFileMeta: { numberOfLines }
// onRequestLines: async (startInclusive, endExclusive) => Promise<string[]>
// virtualChunkSize: number (lines per fetch chunk)
// virtualPreload: number (lines of buffer before & after viewport)
function Editor({
  content,
  setContent,
  highlights,
  highlightTypes,
  theme,
  fontSize = 12,
  onRegisterApi,
  virtualFileMeta = null,
  onRequestLines = null,
  virtualChunkSize = 10000,
  virtualPreload = 5000,
  virtualEvictDistanceChunks = 8,
  virtualPlaceholderLines = null,
}) {
  const isVirtual = !!virtualFileMeta && !!onRequestLines && Number.isInteger(virtualFileMeta.numberOfLines);
  const value = isVirtual ? undefined : content.join('\n');

  const editorRef = useRef(null);
  const monaco = useMonaco();
  // Track current Monaco decoration IDs in a ref to avoid race conditions
  const decorationIdsRef = useRef([]);
  const scheduleRef = useRef(null);
  const virtualizedInitRef = useRef(false);
  const loadedChunksRef = useRef(new Set()); // chunk indices loaded
  const pendingChunksRef = useRef(new Set());
  const lastViewportRef = useRef({ start: 0, end: 0 });
  const requestInflightRef = useRef(0);
  // (no debounce timer in reverted version)

  // Helper: load a chunk (by chunk index) in virtualization mode
  const loadChunk = useCallback(async (chunkIdx) => {
    if (!isVirtual) return;
    if (loadedChunksRef.current.has(chunkIdx) || pendingChunksRef.current.has(chunkIdx)) return;
    const total = virtualFileMeta.numberOfLines;
    const start = chunkIdx * virtualChunkSize;
    if (start >= total) return;
    const end = Math.min(total, start + virtualChunkSize);
    pendingChunksRef.current.add(chunkIdx);
    requestInflightRef.current += 1;
    try {
      const lines = await onRequestLines(start, end);
      if (!Array.isArray(lines) || !editorRef.current || !monaco) return;
      const model = editorRef.current.getModel();
      if (!model) return;
      // Apply edits only if still not loaded
      if (!loadedChunksRef.current.has(chunkIdx)) {
        const text = lines.join('\n');
        // Range inclusive: startLine -> endLine (end exclusive for our lines array)
        const startLineNumber = start + 1;
        const endLineNumber = end; // because end is exclusive zero-based, it's already correct
        model.applyEdits([
          {
            range: new monaco.Range(startLineNumber, 1, endLineNumber, 1),
            text,
            forceMoveMarkers: false,
          }
        ]);
        loadedChunksRef.current.add(chunkIdx);
      }
    } catch (e) {
      console.warn('[virtual] failed loading chunk', chunkIdx, e);
    } finally {
      pendingChunksRef.current.delete(chunkIdx);
      requestInflightRef.current -= 1;
    }
  }, [isVirtual, virtualChunkSize, onRequestLines, virtualFileMeta, monaco]);

  // Load all chunks covering a range
  const ensureRangeLoaded = useCallback((startLineZero, endLineZero) => {
    if (!isVirtual) return;
    const startChunk = Math.floor(startLineZero / virtualChunkSize);
    const endChunk = Math.floor((endLineZero) / virtualChunkSize);
    for (let c = startChunk; c <= endChunk; c++) loadChunk(c);
  }, [isVirtual, virtualChunkSize, loadChunk]);

  // Virtualization viewport handler
  const handleViewportChange = useCallback(() => {
    if (!isVirtual || !editorRef.current) return;
    const editor = editorRef.current;
    const ranges = editor.getVisibleRanges();
    if (!ranges || !ranges.length) return;
    let start = Infinity; let end = -1;
    for (const r of ranges) {
      if (r.startLineNumber - 1 < start) start = r.startLineNumber - 1;
      if (r.endLineNumber - 1 > end) end = r.endLineNumber - 1;
    }
    if (start === Infinity || end === -1) return;
    const total = virtualFileMeta.numberOfLines;
    const bufferedStart = Math.max(0, start - virtualPreload);
    const bufferedEnd = Math.min(total - 1, end + virtualPreload);
    const prev = lastViewportRef.current;
    if (Math.abs(bufferedStart - prev.start) < 50 && Math.abs(bufferedEnd - prev.end) < 50) return;
    lastViewportRef.current = { start: bufferedStart, end: bufferedEnd };
    ensureRangeLoaded(bufferedStart, bufferedEnd);
    // Immediate eviction of far-away chunks
    if (virtualEvictDistanceChunks >= 0) {
      const startChunkBuffered = Math.floor(bufferedStart / virtualChunkSize);
      const endChunkBuffered = Math.floor(bufferedEnd / virtualChunkSize);
      const lastChunk = Math.floor((virtualFileMeta.numberOfLines - 1) / virtualChunkSize);
      const retainMin = Math.max(0, startChunkBuffered - virtualEvictDistanceChunks);
      const retainMax = Math.min(lastChunk, endChunkBuffered + virtualEvictDistanceChunks);
      const toEvict = [];
      loadedChunksRef.current.forEach(c => { if (c < retainMin || c > retainMax) toEvict.push(c); });
      if (toEvict.length && editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) {
          const edits = [];
          for (const c of toEvict) {
            const startZero = c * virtualChunkSize;
            if (startZero >= virtualFileMeta.numberOfLines) continue;
            const endZero = Math.min(virtualFileMeta.numberOfLines, startZero + virtualChunkSize);
            const startLineNumber = startZero + 1;
            const endLineNumber = endZero;
            const lineCount = endZero - startZero;
            const placeholder = lineCount > 0 ? '\n'.repeat(Math.max(0, lineCount - 1)) : '';
            const endCol = model.getLineMaxColumn(endLineNumber);
            edits.push({
              range: new monaco.Range(startLineNumber, 1, endLineNumber, endCol),
              text: placeholder,
              forceMoveMarkers: false,
            });
            loadedChunksRef.current.delete(c);
          }
          if (edits.length) {
            try { model.applyEdits(edits); } catch (e) { console.warn('[virtual] eviction apply failed', e); }
          }
        }
      }
    }
  }, [isVirtual, ensureRangeLoaded, virtualFileMeta, virtualPreload, virtualEvictDistanceChunks, virtualChunkSize]);

  // Store editor instance on mount
  const handleEditorDidMount = (editor) => {
    try {
      console.log('Editor Mounted:', editor);
      editorRef.current = editor;
      // reset decoration ids on fresh mount to avoid stale references
  decorationIdsRef.current = [];
      if (monaco) updateDecorations('mount');
  if (isVirtual) {
        // Attach scroll listener for virtualization
        editor.onDidScrollChange(() => {
          handleViewportChange();
        });
        // Initial viewport load will happen after model prepared in effect below
      }
    } catch (e) {
      console.error('[handleEditorDidMount] error', e);
    }
  };

  // Robust decorations logic
  const updateDecorations = useCallback((reason = 'unknown') => {
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    try {
      const model = editor.getModel();
      if (!model) return;
      const lineCount = model.getLineCount();
      const valid = highlights.filter(h => Number.isInteger(h.line) && h.line >= 0 && h.line < lineCount);
      if (valid.length !== highlights.length) {
        console.warn('[decorations] filtered invalid highlights', { original: highlights, valid, lineCount });
      }
      // Always fully clear previous decorations first to prevent stale color flashes
      if (decorationIdsRef.current.length) {
        try { editor.deltaDecorations(decorationIdsRef.current, []); } catch {}
        decorationIdsRef.current = [];
      }
      if (!valid.length) {
        return; // nothing to apply
      }
      const decorations = valid.map(h => {
        const lineNumber = h.line + 1;
        const endCol = Math.max(1, model.getLineMaxColumn(lineNumber));
        return {
          range: new monaco.Range(lineNumber, 1, lineNumber, endCol),
          options: {
            isWholeLine: true,
            className: `highlight-line-${h.type}`,
            // inlineClassName removed to avoid duplicated layered backgrounds
          }
        };
      });
      try {
        const newIds = editor.deltaDecorations([], decorations);
        decorationIdsRef.current = newIds;
      } catch (e) {
        if (e && e.type === 'cancelation') return;
        console.error('[decorations] delta apply failed', e);
      }
    } catch (e) {
      if (e && e.type === 'cancelation') {
        // benign monaco cancellation (e.g., rapid updates) – ignore noisy log
        return;
      }
      const serialized = e && e.message ? e.message : JSON.stringify(e);
      console.error('[decorations] error', serialized, e);
    }
  }, [monaco, highlights, highlightTypes]);

  // Unified decorations scheduler effect (skip content dependency in virtual mode to avoid massive re-renders)
  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    if (scheduleRef.current) {
      cancelAnimationFrame(scheduleRef.current.af);
      clearTimeout(scheduleRef.current.to);
    }
    const depsKey = JSON.stringify(highlights.map(h => h.line + ':' + h.type)) + '|' + highlightTypes.length + '|' + (isVirtual ? 'v' : content.length);
    const af = requestAnimationFrame(() => updateDecorations('raf:' + depsKey));
    const to = setTimeout(() => updateDecorations('timeout-fallback'), 120);
    scheduleRef.current = { af, to };
    return () => {
      if (scheduleRef.current) {
        cancelAnimationFrame(scheduleRef.current.af);
        clearTimeout(scheduleRef.current.to);
      }
    };
  }, [monaco, highlights, highlightTypes, updateDecorations, content.length, isVirtual]);

  // Inject highlight styles for each highlight type (once per mount / types change)
  useEffect(() => {
    if (!highlightTypes || !highlightTypes.length) return;
    const styleId = 'monaco-dynamic-highlight-styles';
    const existing = document.getElementById(styleId);
    const styleEl = existing || document.createElement('style');
    styleEl.id = styleId;
    const toRgba = (hex) => {
      if (!hex.startsWith('#')) return hex; // assume already css color
      const h = hex.replace('#','');
      if (h.length === 3) {
        const r = h[0]+h[0];
        const g = h[1]+h[1];
        const b = h[2]+h[2];
        return `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},0.25)`;
      }
      if (h.length === 6) {
        const r = h.substring(0,2); const g = h.substring(2,4); const b = h.substring(4,6);
        return `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},0.25)`;
      }
      if (h.length === 8) { // includes alpha
        const r = h.substring(0,2); const g = h.substring(2,4); const b = h.substring(4,6); const a = h.substring(6,8);
        return `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},${(parseInt(a,16)/255).toFixed(2)})`;
      }
      return hex;
    };
    const css = highlightTypes.map(ht => {
      const rgba = toRgba(ht.color);
      return `.monaco-editor .highlight-line-${ht.type} { background: ${rgba} !important; }
      .highlight-line-${ht.type} { background: ${rgba} !important; }`;
    }).join('\n');
    styleEl.innerHTML = css;
    if (!existing) document.head.appendChild(styleEl);
    // force repaint by updating a data attribute on container (if present)
    if (editorRef.current && editorRef.current.getDomNode) {
      const dom = editorRef.current.getDomNode();
      if (dom) dom.setAttribute('data-highlight-refresh', String(Date.now()));
    }
  }, [highlightTypes]);

  const handleChange = (newValue) => {
    //setContent(newValue.split('\n'));
  };

  const getSelectedLines = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return [];
    const sel = editor.getSelection();
    if (!sel) return [];
    const start = Math.min(sel.startLineNumber, sel.endLineNumber);
    const end = Math.max(sel.startLineNumber, sel.endLineNumber);
    const lines = [];
    for (let i = start; i <= end; i++) lines.push(i - 1); // convert to 0-based
    return lines;
  }, []);

  const setCursorToLine = useCallback((zeroBasedLine) => {
    const editor = editorRef.current;
    if (!editor || typeof zeroBasedLine !== 'number') return;
    const model = editor.getModel();
    if (!model) return;
    const max = model.getLineCount() - 1;
    const clamped = Math.max(0, Math.min(max, zeroBasedLine));
    const lineNumber = clamped + 1; // monaco is 1-based
    try {
      editor.setSelection({ startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 });
      editor.revealLineInCenterIfOutsideViewport(lineNumber, 1 /* scrollType Smooth */);
      editor.focus();
    } catch (e) {
      // non-fatal
      console.warn('setCursorToLine failed', e);
    }
  }, []);

  // Expose lightweight API to parent (selection helpers)
  useEffect(() => {
    if (onRegisterApi) onRegisterApi({ getSelectedLines, setCursorToLine });
  }, [onRegisterApi, getSelectedLines, setCursorToLine]);

  // Log readiness once
  useEffect(() => {
    if (monaco) console.log('[monaco] ready');
  }, [monaco]);

  // Define both themes once when monaco ready
  useEffect(() => {
    if (!monaco) return;
    try {
      monaco.editor.defineTheme('vc-dark', {
        base: 'vs-dark', inherit: true,
        rules: [{ token: '', foreground: 'e6edf3' }],
        colors: {
          'editor.background': '#1c252c',
          'editorLineNumber.foreground': '#526170',
          'editorLineNumber.activeForeground': '#9db2c3',
          'editor.selectionBackground': '#264f78',
        }
      });
      monaco.editor.defineTheme('vc-light', {
        base: 'vs', inherit: true,
        rules: [],
        colors: { 'editor.background': '#ffffff' }
      });
    // Immediately apply current theme after (re)definition
    monaco.editor.setTheme(theme === 'dark' ? 'vc-dark' : 'vc-light');
    } catch (e) { console.warn('defineTheme init failed', e); }
  }, [monaco, theme]);

  // Dynamically apply font size changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      editor.updateOptions({ fontSize });
    } catch (e) {
      console.warn('fontSize update failed', e);
    }
  }, [fontSize]);

  // Initialize viewport load (model already has placeholder via defaultValue)
  useEffect(() => {
    if (!isVirtual || !editorRef.current || virtualizedInitRef.current || !virtualFileMeta) return;
    virtualizedInitRef.current = true;
    setTimeout(() => handleViewportChange(), 30);
  }, [isVirtual, handleViewportChange, virtualFileMeta]);

  // (no timer cleanup required after revert)

  // (Theme now passed directly to MonacoEditor prop to avoid resets from options changes)

  return (
  <div className="editor-container" style={{ position: 'relative' }}>
      {process.env.NODE_ENV === 'development' && console.log('Rendering MonacoEditor')}
  {/* Create Group button removed; now surfaced in HighlightSelector */}
    <MonacoEditor
      key={theme + (isVirtual ? '-virtual-' + (virtualFileMeta ? virtualFileMeta.numberOfLines : '0') : '-std')}
        height="100%"
        width="100%"
        language="plaintext"
      {...(isVirtual ? { defaultValue: (virtualPlaceholderLines ? '\n'.repeat(Math.max(0, virtualPlaceholderLines - 1)) : (virtualFileMeta ? '\n'.repeat(Math.max(0, virtualFileMeta.numberOfLines - 1)) : '')) } : { value })}
        theme={theme === 'dark' ? 'vc-dark' : 'vc-light'}
        onChange={handleChange}
        options={{
          minimap: { enabled: false },
          fontSize: fontSize,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          readOnly: false,
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
}

export default Editor;
