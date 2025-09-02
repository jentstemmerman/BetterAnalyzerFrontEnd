import React, { useRef, useEffect, useState, useCallback } from 'react';
import MonacoEditor, { useMonaco } from '@monaco-editor/react';

function Editor({ content, setContent, highlights, highlightTypes, onCreateGroup, theme }) {
  const value = content.join('\n');

  const editorRef = useRef(null);
  const monaco = useMonaco();
  const [decorationIds, setDecorationIds] = useState([]);
  const scheduleRef = useRef(null);

  // Store editor instance on mount
  const handleEditorDidMount = (editor) => {
    try {
      console.log('Editor Mounted:', editor);
      editorRef.current = editor;
      if (monaco) updateDecorations('mount');
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
      const decorations = valid.map(h => {
        const lineNumber = h.line + 1;
        const endCol = Math.max(1, model.getLineMaxColumn(lineNumber));
        return {
          range: new monaco.Range(lineNumber, 1, lineNumber, endCol),
          options: {
            isWholeLine: true,
            className: `highlight-line-${h.type}`,
            inlineClassName: `highlight-line-${h.type}`,
          }
        };
      });
      setDecorationIds(prev => editor.deltaDecorations(prev, decorations));
    } catch (e) {
      if (e && e.type === 'cancelation') {
        // benign monaco cancellation (e.g., rapid updates) – ignore noisy log
        return;
      }
      const serialized = e && e.message ? e.message : JSON.stringify(e);
      console.error('[decorations] error', serialized, e);
    }
  }, [monaco, highlights]);

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
  }, [monaco, highlights, content, updateDecorations]);

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
  }, [highlightTypes]);

  const handleChange = (newValue) => {
    setContent(newValue.split('\n'));
  };

  const getSelectedLines = () => {
    const editor = editorRef.current;
    if (!editor) return [];
    const sel = editor.getSelection();
    if (!sel) return [];
    const start = Math.min(sel.startLineNumber, sel.endLineNumber);
    const end = Math.max(sel.startLineNumber, sel.endLineNumber);
    const lines = [];
    for (let i = start; i <= end; i++) lines.push(i - 1); // convert to 0-based
    return lines;
  };

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
    } catch (e) { console.warn('defineTheme init failed', e); }
  }, [monaco]);

  // Apply theme on each toggle with forced reapply fallback
  useEffect(() => {
    if (!monaco) return;
    const target = theme === 'dark' ? 'vc-dark' : 'vc-light';
    try { monaco.editor.setTheme(target); } catch (e) { console.warn('setTheme failed', e); }
    // Fallback reapply next frame (Monaco can ignore immediate setTheme during layout)
    const raf = requestAnimationFrame(() => {
      try { monaco.editor.setTheme(target); } catch {}
    });
    const to = setTimeout(() => {
      try { monaco.editor.setTheme(target); } catch {}
    }, 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(to); };
  }, [monaco, theme]);

  return (
    <div className="editor-container" style={{ position: 'relative', height: '60vh' }}>
      {process.env.NODE_ENV === 'development' && console.log('Rendering MonacoEditor')}
      {onCreateGroup && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: '8px' }}>
          <button
            style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
            onClick={() => {
              const lines = getSelectedLines();
              if (!lines.length) {
                // eslint-disable-next-line no-alert
                alert('Select one or more lines first.');
                return;
              }
              onCreateGroup(lines);
            }}
          >Create Group</button>
        </div>
      )}
      <MonacoEditor
        key={theme} /* force re-render to ensure background updates */
        height="100%"
        width="100%"
        language="plaintext"
        value={value}
        onChange={handleChange}
        options={{
          minimap: { enabled: false },
          fontSize: 16,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          theme: 'vs',
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
}

export default Editor;
