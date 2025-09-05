import React, { useRef, useEffect, useState, useCallback } from 'react';
import MonacoEditor, { useMonaco } from '@monaco-editor/react';

function Editor({ content, setContent, highlights, highlightTypes, theme, fontSize = 16, onRegisterApi, lineNumberOffset = 0, onViewportChange }) {
  const value = content.join('\n');

  const editorRef = useRef(null);
  const monaco = useMonaco();
  // Track current Monaco decoration IDs in a ref to avoid race conditions
  const decorationIdsRef = useRef([]);
  const scheduleRef = useRef(null);
  // Always use latest onViewportChange without needing to rebind Monaco listeners
  const viewportCbRef = useRef(onViewportChange);
  useEffect(() => { viewportCbRef.current = onViewportChange; }, [onViewportChange]);

  // Safely determine line height with multiple fallbacks (monaco option -> fontInfo -> DOM probe -> default)
  const resolveLineHeight = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return 18;
    try {
      // Primary: direct lineHeight editor option (may be undefined early in lifecycle in rare race cases)
      if (monaco?.editor?.EditorOption && monaco.editor.EditorOption.lineHeight !== undefined) {
        const lh = editor.getOption?.(monaco.editor.EditorOption.lineHeight);
        if (typeof lh === 'number' && lh > 0) return lh;
      }
      // Secondary: fontInfo lineHeight
      if (monaco?.editor?.EditorOption && monaco.editor.EditorOption.fontInfo !== undefined) {
        const fontInfo = editor.getOption?.(monaco.editor.EditorOption.fontInfo);
        if (fontInfo?.lineHeight && fontInfo.lineHeight > 0) return fontInfo.lineHeight;
      }
      // Tertiary: Inspect first rendered line DOM element
      const dom = editor.getDomNode?.();
      if (dom) {
        const lineContainer = dom.querySelector('.view-lines');
        if (lineContainer && lineContainer.firstChild) {
          const probe = lineContainer.firstChild;
            // clientHeight preferred; fallback to getBoundingClientRect
          const h = (probe.clientHeight || probe.getBoundingClientRect?.().height || 0);
          if (h > 0) return h;
        }
      }
    } catch (_) { /* swallow */ }
    return 18; // conservative default
  }, [monaco]);

  // Store editor instance on mount + attach viewport listeners immediately
  const handleEditorDidMount = (editor) => {
    try {
      console.log('Editor Mounted:', editor);
      editorRef.current = editor;
      decorationIdsRef.current = [];
      if (monaco) updateDecorations('mount');
  if (viewportCbRef.current) {
        const fire = () => {
          try {
            const vr = editor.getVisibleRanges();
            if (vr && vr.length) {
              const r = vr[0];
      viewportCbRef.current && viewportCbRef.current({
                firstVisibleLine: r.startLineNumber - 1 + lineNumberOffset,
                lastVisibleLine: r.endLineNumber - 1 + lineNumberOffset,
                cause: 'init'
              });
            }
          } catch {}
        };
        fire();
        editor.onDidScrollChange(() => {
          try {
            const vr = editor.getVisibleRanges();
            if (vr && vr.length) {
              const r = vr[0];
              const lineHeight = resolveLineHeight();
              const layout = editor.getLayoutInfo?.();
              const capacity = layout ? Math.ceil(layout.height / lineHeight) : (r.endLineNumber - r.startLineNumber + 1);
      viewportCbRef.current && viewportCbRef.current({
                firstVisibleLine: r.startLineNumber - 1 + lineNumberOffset,
                lastVisibleLine: r.endLineNumber - 1 + lineNumberOffset,
                capacity,
                cause: 'scroll'
              });
            }
          } catch {}
        });
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

  // Unified decorations scheduler effect
  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    // debounce via animation frame & timeout for stability
    if (scheduleRef.current) {
      cancelAnimationFrame(scheduleRef.current.af);
      clearTimeout(scheduleRef.current.to);
    }
    const af = requestAnimationFrame(() => updateDecorations('raf'));
    const to = setTimeout(() => updateDecorations('timeout-fallback'), 120);
    scheduleRef.current = { af, to };
    return () => {
      if (scheduleRef.current) {
        cancelAnimationFrame(scheduleRef.current.af);
        clearTimeout(scheduleRef.current.to);
      }
    };
  }, [monaco, highlights, content, highlightTypes, updateDecorations]);

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
    setContent(newValue.split('\n'));
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

  const getViewportInfo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return null;
    try {
      const vr = editor.getVisibleRanges();
      if (!vr || !vr.length) return null;
      const r = vr[0];
    const lineHeight = resolveLineHeight();
      const layout = editor.getLayoutInfo?.();
      const capacity = layout ? Math.ceil(layout.height / lineHeight) : (r.endLineNumber - r.startLineNumber + 1);
      return {
        firstVisibleLine: r.startLineNumber - 1 + lineNumberOffset,
        lastVisibleLine: r.endLineNumber - 1 + lineNumberOffset,
        capacity,
      };
    } catch {
      return null;
    }
  }, [lineNumberOffset, monaco, resolveLineHeight]);

  // Expose lightweight API to parent (selection helpers + viewport info)
  useEffect(() => {
    if (onRegisterApi) {
      onRegisterApi({ getSelectedLines, setCursorToLine, getViewportInfo, __rawEditor: editorRef.current });
    }
  }, [onRegisterApi, getSelectedLines, setCursorToLine, getViewportInfo]);

  // After content updates, re-fire viewport callback (model changed, scroll pos may shift)
  useEffect(() => {
    if (!viewportCbRef.current) return;
    const info = getViewportInfo();
    if (info) {
      viewportCbRef.current && viewportCbRef.current({ firstVisibleLine: info.firstVisibleLine, lastVisibleLine: info.lastVisibleLine, capacity: info.capacity, cause: 'content' });
    }
  }, [content, getViewportInfo]);

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

  // (Theme now passed directly to MonacoEditor prop to avoid resets from options changes)

  return (
	<div className="editor-container" style={{ position: 'relative' }}>
      {process.env.NODE_ENV === 'development' && console.log('Rendering MonacoEditor')}
  {/* Create Group button removed; now surfaced in HighlightSelector */}
      <MonacoEditor
        key={theme}
        height="100%"
        width="100%"
        language="plaintext"
        value={value}
        theme={theme === 'dark' ? 'vc-dark' : 'vc-light'}
        onChange={handleChange}
        options={{
          minimap: { enabled: false },
          fontSize: fontSize,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          lineNumbers: (ln) => String(ln + lineNumberOffset),
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
}

export default Editor;
