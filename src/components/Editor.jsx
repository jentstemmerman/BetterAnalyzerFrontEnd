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
  intervals = [],
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
  onCursorLineChange = null,
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
  // Replaces requestVersionRef: now a "viewport generation" incremented once per viewport change
  const generationRef = useRef(0);
  const decorationRefreshRafRef = useRef(0);
  const updateDecorationsRef = useRef(null);

  // Debounced decorations refresher used by virtualization events (chunk loads, viewport enters)
  const scheduleDecorationRefresh = useCallback((reason = 'unknown') => {
    if (!editorRef.current) return;
    if (decorationRefreshRafRef.current) cancelAnimationFrame(decorationRefreshRafRef.current);
    decorationRefreshRafRef.current = requestAnimationFrame(() => {
      try {
        if (updateDecorationsRef.current) updateDecorationsRef.current(reason);
      } catch (e) {
        console.warn('[decorations] scheduleDecorationRefresh failed', reason, e);
      }
    });
  }, []);

  // Helper: load a chunk (by chunk index) in virtualization mode
  const loadChunk = useCallback(async (chunkIdx, generation) => {
    if (!isVirtual) return;
    if (loadedChunksRef.current.has(chunkIdx) || pendingChunksRef.current.has(chunkIdx)) return;
    const total = virtualFileMeta.numberOfLines;
    const start = chunkIdx * virtualChunkSize;
    if (start >= total) return;
    const end = Math.min(total, start + virtualChunkSize);
    pendingChunksRef.current.add(chunkIdx);
    requestInflightRef.current += 1;
    const myGeneration = generation;

    console.log('[virtual] loading chunk', { chunkIdx, start, end, generation: myGeneration, inflight: requestInflightRef.current });

    try {
      const lines = await onRequestLines(start, end);
      // Previous logic aborted applying a chunk if the viewport generation advanced.
      // That led to permanent blank regions if the user kept scrolling (chunk kept
      // returning as stale and its placeholder blank lines remained). We now allow
      // applying the data if the chunk is still relevant (intersects retained viewport
      // window) – and even if not, we prefer to apply rather than leave blanks.
      if (myGeneration !== generationRef.current) {
        try {
          const vp = lastViewportRef.current;
          const chunkStart = start;
            const chunkEnd = end - 1;
          const stillWithinBuffered = (
            chunkEnd >= (vp.start - virtualPreload) &&
            chunkStart <= (vp.end + virtualPreload)
          );
          if (!stillWithinBuffered) {
            // It's truly far away; we can skip applying to reduce unnecessary DOM work.
            // Schedule a re-fetch if it becomes needed again.
            // console.log('[virtual] skip applying stale distant chunk', { chunkIdx, myGeneration, currentGen: generationRef.current });
            return;
          }
          // else fall through and apply anyway – prevents blank holes.
          // console.log('[virtual] applying stale-but-relevant chunk', { chunkIdx, myGeneration, currentGen: generationRef.current });
        } catch (e) {
          // On any error in relevance calculation, proceed with applying to be safe.
        }
      }
      const expected = end - start;
      if (!Array.isArray(lines) || lines.length !== expected) {
        console.error('[virtual] chunk size mismatch – server bug', { chunkIdx, start, end, expected, got: Array.isArray(lines) ? lines.length : 'non-array' });
        return;
      }
      if (!editorRef.current || !monaco) {
        console.warn('[virtual] editor gone before chunk loaded', { chunkIdx });
        return;
      }
      const model = editorRef.current.getModel();
      if (!model) {
        console.warn('[virtual] editor model gone before chunk loaded', { chunkIdx });
        return;
      }
      if (!loadedChunksRef.current.has(chunkIdx)) {
        console.log('[virtual] applying loaded chunk', { chunkIdx, start, end, linesLoaded: lines.length });
        const text = lines.join('\n');
        const startLineNumber = start + 1;
        const replaceEndLinePlusOne = end + 1;
        model.applyEdits([{
          range: new monaco.Range(startLineNumber, 1, replaceEndLinePlusOne, 1),
          text: text + (replaceEndLinePlusOne <= model.getLineCount() ? '\n' : ''),
          forceMoveMarkers: false,
        }]);
        loadedChunksRef.current.add(chunkIdx);
        // Single refresh after chunk applies (debounced by RAF)
        scheduleDecorationRefresh('chunk:' + chunkIdx);
      }
    } catch (e) {
      console.warn('[virtual] failed loading chunk', chunkIdx, e);
    } finally {
      pendingChunksRef.current.delete(chunkIdx);
      requestInflightRef.current -= 1;
    }
  }, [isVirtual, virtualChunkSize, onRequestLines, virtualFileMeta, monaco, highlights, scheduleDecorationRefresh]);

  // Load all chunks covering a range (now passes generation)
  const ensureRangeLoaded = useCallback((startLineZero, endLineZero, generation) => {
    if (!isVirtual) return;
    const startChunk = Math.floor(startLineZero / virtualChunkSize);
    const endChunk = Math.floor(endLineZero / virtualChunkSize);
    for (let c = startChunk; c <= endChunk; c++) loadChunk(c, generation);
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
    // Keep a reference to the previous viewport BEFORE updating so we can compare highlight presence
    const prevViewport = lastViewportRef.current;
    if (Math.abs(bufferedStart - prevViewport.start) < 50 && Math.abs(bufferedEnd - prevViewport.end) < 50) {
      // Minor scroll ignored
      return;
    }
    lastViewportRef.current = { start: bufferedStart, end: bufferedEnd };

    // New viewport cycle: bump generation once (not per chunk)
    const gen = ++generationRef.current;
  ensureRangeLoaded(bufferedStart, bufferedEnd, gen);

    // If new viewport includes highlight lines not previously visible, refresh
    const hasViewportHighlights = highlights.some(h => h.line >= bufferedStart && h.line <= bufferedEnd);
    const prevHad = highlights.some(h => h.line >= prevViewport.start && h.line <= prevViewport.end);
    if (hasViewportHighlights && !prevHad) {
      scheduleDecorationRefresh('viewportEnter');
    }
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
  }, [isVirtual, ensureRangeLoaded, virtualFileMeta, virtualPreload, virtualEvictDistanceChunks, virtualChunkSize, highlights, scheduleDecorationRefresh]);

  // Store editor instance on mount
  const handleEditorDidMount = (editor) => {
    try {
      console.log('Editor Mounted:', editor);
      editorRef.current = editor;
      decorationIdsRef.current = [];
      if (monaco) updateDecorations('mount');
      if (isVirtual) {
        const scrollDisposable = editor.onDidScrollChange(() => {
          handleViewportChange();
        });
        // Clean up on unmount
        editorRef.current.__virtualScrollDisposable = scrollDisposable;
      }
      // Track cursor position changes and notify parent
      if (onCursorLineChange) {
        const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
          onCursorLineChange(e.position.lineNumber - 1); // 0-based
        });
        editorRef.current.__cursorDisposable = cursorDisposable;
      }
      // Measure and set scrollbar width CSS variable for precise highlight exclusion
      try {
        const measureScrollbar = () => {
          const scTest = document.createElement('div');
          scTest.style.width = '100px';
          scTest.style.height = '100px';
          scTest.style.overflow = 'scroll';
          scTest.style.position = 'absolute';
          scTest.style.top = '-9999px';
          document.body.appendChild(scTest);
          const width = scTest.offsetWidth - scTest.clientWidth; // vertical scrollbar width
          document.body.removeChild(scTest);
          if (width > 0 && width < 60) {
            document.documentElement.style.setProperty('--editor-scrollbar-reserve', width + 'px');
          }
        };
        measureScrollbar();
        // Recalculate on window resize (scrollbar metrics can change with OS settings / zoom)
        window.addEventListener('resize', measureScrollbar, { passive: true });
        editorRef.current.__sbMeasure = measureScrollbar;
      } catch (e) {
        console.warn('[scrollbar-measure] failed', e);
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
      if (valid.length !== highlights.length) console.warn('[decorations] filtered invalid highlights', { originalCount: highlights.length, validCount: valid.length, lineCount });
      // Always fully clear previous decorations first to prevent stale color flashes
      if (decorationIdsRef.current.length) {
        try { editor.deltaDecorations(decorationIdsRef.current, []); } catch {}
        decorationIdsRef.current = [];
      }
      // Build interval-based range decorations (one per interval, not per line)
      const intervalDecorations = (intervals || []).filter(
        iv => iv.lineNumber >= 0 && iv.lineNumber + iv.lineCount <= lineCount
      ).map(iv => {
        const startLn = iv.lineNumber + 1;
        const endLn = Math.min(iv.lineNumber + iv.lineCount, lineCount);
        const endCol = Math.max(1, model.getLineMaxColumn(endLn));
        return {
          range: new monaco.Range(startLn, 1, endLn, endCol),
          options: {
            isWholeLine: true,
            className: `highlight-line-${iv.type}`,
          }
        };
      });
      if (!valid.length && !intervalDecorations.length) return; // nothing to apply
      const decorations = valid.map(h => {
        const lineNumber = h.line + 1;
        const endCol = Math.max(1, model.getLineMaxColumn(lineNumber));
        return {
          range: new monaco.Range(lineNumber, 1, lineNumber, endCol),
          options: {
            isWholeLine: true,
            className: `highlight-line-${h.type}`,
          }
        };
      }).concat(intervalDecorations);
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
  }, [monaco, highlights, intervals, highlightTypes]);

  // Sync the ref AFTER updateDecorations is defined to avoid temporal dead zone
  useEffect(() => { updateDecorationsRef.current = updateDecorations; }, [updateDecorations]);

  // Unified decorations scheduler effect (skip content dependency in virtual mode to avoid massive re-renders)
  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    if (scheduleRef.current) {
      cancelAnimationFrame(scheduleRef.current.af);
      clearTimeout(scheduleRef.current.to);
    }
    const hlKey = highlights.map(h => h.line + ':' + h.type).join(',');
    const ivKey = intervals.map(iv => iv.lineNumber + ':' + iv.lineCount + ':' + iv.type).join(',');
    const depsKey = hlKey + '|' + ivKey + '|' + highlightTypes.length + '|' + (isVirtual ? 'v' : content.length);
    const af = requestAnimationFrame(() => updateDecorations('raf:' + depsKey));
    const to = setTimeout(() => updateDecorations('timeout-fallback'), 120);
    scheduleRef.current = { af, to };
    return () => {
      if (scheduleRef.current) {
        cancelAnimationFrame(scheduleRef.current.af);
        clearTimeout(scheduleRef.current.to);
      }
    };
  }, [monaco, highlights, intervals, highlightTypes, updateDecorations, content.length, isVirtual]);

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
    // Build CSS so that highlight background does NOT extend underneath the vertical scrollbar.
    // We reserve a fixed width on the right (default 14px, customizable via --editor-scrollbar-reserve)
    // by drawing the color with a ::before pseudo element that stops before the scrollbar.
    const css = highlightTypes.map(ht => {
      const rgba = toRgba(ht.color);
      return `/* Highlight style for ${ht.type} (excluding scrollbar area) */
      .monaco-editor .highlight-line-${ht.type} { position: relative; background: none !important; }
      .monaco-editor .highlight-line-${ht.type}::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; right: var(--editor-scrollbar-reserve,14px); background: ${rgba} !important; pointer-events: none; }
      /* Fallback outside monaco (if ever used) */
      .highlight-line-${ht.type} { position: relative; background: none !important; }
      .highlight-line-${ht.type}::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; right: 0; background: ${rgba} !important; pointer-events: none; }`;
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

  const setCursorToLine = useCallback((zeroBasedLine, opts = {}) => {
    const editor = editorRef.current;
    if (!editor || typeof zeroBasedLine !== 'number') return;
    const model = editor.getModel();
    if (!model) return;
    const max = model.getLineCount() - 1;
    const clamped = Math.max(0, Math.min(max, zeroBasedLine));
    const lineNumber = clamped + 1; // monaco is 1-based
    const desiredTopPaddingRatio = typeof opts.topPaddingRatio === 'number' ? opts.topPaddingRatio : 0.15; // 15% from top
    try {
      editor.setSelection({ startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 });
      // Custom scroll: compute target scrollTop so line sits ~15% below top
      const layoutInfo = editor.getLayoutInfo();
      const lineHeight = editor.getOption?.(monaco.editor.EditorOption.lineHeight) || 18;
      const viewHeight = layoutInfo?.height || editor.getDomNode()?.clientHeight || 0;
      const topPadLines = Math.floor((viewHeight * desiredTopPaddingRatio) / lineHeight);
      const targetTopLine = Math.max(1, lineNumber - topPadLines);
      // Use revealRangeNearTop if available (Monaco 0.42+); fallback to manual scroll if not.
      const range = new monaco.Range(targetTopLine, 1, targetTopLine, 1);
      if (editor.revealRangeNearTop) {
        editor.revealRangeNearTop(range, monaco.editor.ScrollType.Smooth);
      } else if (editor.revealLineNearTop) {
        editor.revealLineNearTop(targetTopLine, monaco.editor.ScrollType.Smooth);
      } else {
        editor.revealLineInCenterIfOutsideViewport(lineNumber, monaco.editor.ScrollType.Smooth);
      }
      // Post-adjustment: enforce approximate offset using scrollTop math if API didn't place it
      try {
        const viewLines = editor.getVisibleRanges()?.[0];
        if (viewLines) {
          const firstVisible = viewLines.startLineNumber;
          const currentOffsetLines = lineNumber - firstVisible;
          const desiredOffsetLines = topPadLines;
          if (Math.abs(currentOffsetLines - desiredOffsetLines) > 2) { // tolerance
            const scrollTop = editor.getScrollTop();
            const deltaLines = (desiredOffsetLines - currentOffsetLines);
            const newScrollTop = scrollTop - deltaLines * lineHeight;
            editor.setScrollTop(newScrollTop);
          }
        }
      } catch {}
      // Final visibility assurance
      editor.revealLine(lineNumber, monaco.editor.ScrollType.Smooth);
      editor.focus();
    } catch (e) {
      console.warn('setCursorToLine failed', e);
    }
  }, [monaco]);

  const getLineText = useCallback((zeroBasedLine) => {
    const ed = editorRef.current;
    if (!ed || typeof zeroBasedLine !== 'number') return '';
    try {
      const model = ed.getModel();
      if (!model) return '';
      const total = model.getLineCount();
      if (zeroBasedLine < 0 || zeroBasedLine >= total) return '';
      return model.getLineContent(zeroBasedLine + 1);
    } catch {
      return '';
    }
  }, []);

  // Expose lightweight API to parent (selection helpers + line text)
  useEffect(() => {
    if (onRegisterApi) onRegisterApi({ getSelectedLines, setCursorToLine, getLineText });
  }, [onRegisterApi, getSelectedLines, setCursorToLine, getLineText]);

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
          // Disable occurrences (word) highlighting to avoid known Monaco dispose race throwing uncaught Error during rapid model swaps
          occurrencesHighlight: false,
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
}

export default Editor;
