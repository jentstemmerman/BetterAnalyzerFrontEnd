import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import Editor from './components/Editor';
import MiniMap from './components/MiniMap';
import HighlightSelector from './components/HighlightSelector';
import DocumentSelector from './components/DocumentSelector';
import { GetServerDirectoryListing, getMetadata, fetchFileLines } from './api/library';

const exampleDocuments = [
  {
    name: 'Sample Document',
    content: [
      'This is a sample document.',
      'You can edit this text.',
      'Some lines are highlighted.',
      'Try toggling highlight buttons above.',
      'The minimap shows all highlights.',
      'Enjoy your professional editor!',
    ],
    highlights: [
      { line: 2, type: 'info' },
      { line: 3, type: 'warning' },
      { line: 4, type: 'success' }
    ]
  }
];

const baseHighlightTypes = [
  { type: 'info', label: 'Info', color: '#4F8EF7' },
  { type: 'warning', label: 'Warning', color: '#F7B32B' },
  { type: 'success', label: 'Success', color: '#4FCF7F' }
];

function App() {
  const [selectedDocIdx, setSelectedDocIdx] = useState(0);
  const [highlightTypes, setHighlightTypes] = useState(baseHighlightTypes);
  const [activeHighlights, setActiveHighlights] = useState(baseHighlightTypes.map(ht => ht.type));
  const [docContent, setDocContent] = useState(exampleDocuments[0].content);
  const [docHighlights, setDocHighlights] = useState(exampleDocuments[0].highlights);
  const [groupCounter, setGroupCounter] = useState(1);
  const [theme, setTheme] = useState(() => (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [fontSize, setFontSize] = useState(16);
  const [showColorManager, setShowColorManager] = useState(false);
  const [minimapWidth, setMinimapWidth] = useState(15);
  const [serverEntries, setServerEntries] = useState([]); // array of {fileName,filePath,isDirectory}
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [userId] = useState(0); // TODO: replace with real user context
  const [currentServerFile, setCurrentServerFile] = useState(null); // entry object
  const [currentServerIndex, setCurrentServerIndex] = useState(-1);
  const [fileMeta, setFileMeta] = useState(null); // { size, numberOfLines }
  // Large file streaming + virtual window state
  const [nextLineToLoad, setNextLineToLoad] = useState(0); // global next line index to request (exclusive)
  const [isLoadingLines, setIsLoadingLines] = useState(false);
  const fileLoadIdRef = React.useRef(0); // increments each file selection to invalidate pending loads
  const nextLineRef = React.useRef(0); // mirrors nextLineToLoad in ref form for async usage
  const isLoadingRef = React.useRef(false);
  const windowStartRef = React.useRef(0); // global starting line index represented by docContent[0]
  const [windowStart, setWindowStart] = useState(0); // mirrored state for render (lineNumberOffset)
  const lastViewportRef = React.useRef({ first: -1, last: -1 });
  const lastGlobalLastRef = React.useRef(-1); // track previous globalLast to detect real user scroll
  const retryMapRef = React.useRef({}); // { startLine: { attempts, nextDelayMs } }
  const [fetchError, setFetchError] = useState(null); // { message, atLine }
  const LINES_PER_CHUNK = 800; // fetch size from server
  const MAX_BUFFER_LINES = 20000; // keep at most this many lines resident to avoid OOM
  const BOTTOM_PREFETCH_MARGIN = 600; // when viewport close to bottom loaded region, fetch more
  const TOP_PREFETCH_MARGIN = 600; // (future) allow backward paging when scrolled near top & trimmed
  const ENABLE_BACKWARD_FETCH = false; // set true if we implement reverse fetch later
  const PREFETCH_AHEAD = 800; // trigger another fetch when fewer than this many lines remain ahead of viewport

  const handleHighlightToggle = (type) => {
    setActiveHighlights(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleDocumentSelect = (idx) => {
    setSelectedDocIdx(idx);
    // Reset to original document state when switching (custom groups not persisted across docs for now)
    setDocContent(exampleDocuments[idx].content);
    setDocHighlights(exampleDocuments[idx].highlights);
    setHighlightTypes(baseHighlightTypes);
    setActiveHighlights(baseHighlightTypes.map(ht => ht.type));
    setGroupCounter(1);
  };

  // Generate a pastel HEX color (so it works with <input type="color">)
  const randomPastel = () => {
    const h = Math.random(); // 0..1
    const s = 0.55; // moderate saturation
    const l = 0.72; // lightness
    const hue = h * 6;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hue >= 0 && hue < 1) { r = c; g = x; }
    else if (hue >= 1 && hue < 2) { r = x; g = c; }
    else if (hue >= 2 && hue < 3) { g = c; b = x; }
    else if (hue >= 3 && hue < 4) { g = x; b = c; }
    else if (hue >= 4 && hue < 5) { r = x; b = c; }
    else { r = c; b = x; }
    const toHex = (v) => {
      const hv = Math.round((v + m) * 255).toString(16).padStart(2, '0');
      return hv;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const addHighlightGroup = useCallback((name, lines) => {
    if (!lines || !lines.length) return;
    // Create unique type id
    let baseType = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
    let type = baseType;
    let i = 1;
    const existingTypes = new Set(highlightTypes.map(h => h.type));
    while (existingTypes.has(type)) {
      type = `${baseType}-${i++}`;
    }
    const color = randomPastel();
    const newType = { type, label: name, color };
    setHighlightTypes(prev => [...prev, newType]);
    setActiveHighlights(prev => [...prev, type]);
    setDocHighlights(prev => {
      const currentLines = new Set(prev.filter(h => h.type === type).map(h => h.line));
      const additions = lines.filter(l => !currentLines.has(l)).map(l => ({ line: l, type }));
      return [...prev, ...additions];
    });
  }, [highlightTypes]);

  const removeHighlightGroup = useCallback((type) => {
    const isBase = baseHighlightTypes.some(b => b.type === type);
    if (isBase) {
      const confirmed = window.confirm(`Remove base highlight group "${type}"? This will delete its highlights.`);
      if (!confirmed) return;
    }
    setHighlightTypes(prev => prev.filter(ht => ht.type !== type));
    setActiveHighlights(prev => prev.filter(t => t !== type));
    setDocHighlights(prev => prev.filter(h => h.type !== type));
  }, []);

  const updateHighlightColor = useCallback((type, color) => {
    // Basic hex normalization (#RRGGBB only)
    let c = color.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
      // expand shorthand
      c = '#' + c.slice(1).split('').map(ch => ch + ch).join('');
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) return; // ignore invalid
    setHighlightTypes(prev => prev.map(ht => ht.type === type ? { ...ht, color: c } : ht));
  }, []);

  const highlights = docHighlights.filter(h => activeHighlights.includes(h.type));

  // Apply theme attribute & persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('vc-theme', theme); } catch {}
  }, [theme]);

  // Load persisted theme
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vc-theme');
      if (saved === 'dark' || saved === 'light') setTheme(saved);
    } catch {}
  }, []);

  const editorApiRef = React.useRef(null);

  const handleCreateGroupFromSelection = () => {
    const api = editorApiRef.current;
    if (!api) return;
    const lines = api.getSelectedLines();
    if (!lines.length) {
      alert('Select one or more lines in the editor first.');
      return;
    }
    const name = window.prompt('Name for highlight group', `Group ${groupCounter}`);
    if (name !== null) {
      addHighlightGroup(name.trim() || `Group ${groupCounter}`, lines);
      setGroupCounter(c => c + 1);
    }
  };

  // Fetch server directory listing once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingFiles(true);
      const entries = await GetServerDirectoryListing(userId, '', undefined);
      if (cancelled) return;
      if (Array.isArray(entries) && entries.length) setServerEntries(entries);
      setLoadingFiles(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleServerFileSelect = async (entry, idx) => {
    setSelectedDocIdx(idx); // not used when server entries present but kept for state symmetry
    setCurrentServerFile(entry);
    setCurrentServerIndex(idx);
    setDocContent([`Loading ${entry.fileName} ...`]);
    setDocHighlights([]);
    setHighlightTypes(baseHighlightTypes);
    setActiveHighlights(baseHighlightTypes.map(ht => ht.type));
    setFileMeta(null);
    setNextLineToLoad(0);
    nextLineRef.current = 0;
    windowStartRef.current = 0;
    setWindowStart(0);
    fileLoadIdRef.current += 1; // invalidate previous loads
    const loadIdSnapshot = fileLoadIdRef.current;
    // Fetch metadata then first chunk
    try {
      const meta = await getMetadata(entry.fileName, userId);
      if (!meta) {
        setDocContent([`Failed to load metadata for ${entry.fileName}`]);
        return;
      }
      if (fileLoadIdRef.current !== loadIdSnapshot) return; // selection changed
      setFileMeta(meta);
      await loadMoreLines(entry.fileName, meta, loadIdSnapshot);
      // Adaptive bootstrap: keep fetching until we have enough lines to scroll beyond viewport
      setTimeout(() => adaptiveBootstrap(meta, entry.fileName), 20);
    } catch (e) {
      setDocContent([`Error loading file ${entry.fileName}`]);
    }
  };

  const loadMoreLines = useCallback(async (fileName, metaOverride = null, loadIdOverride = null) => {
    if (isLoadingRef.current) return; // prevent overlap
    const meta = metaOverride || fileMeta;
    if (!meta) return;
    const start = nextLineRef.current; // global line to start fetching
    if (start >= meta.numberOfLines) return; // nothing left
    if (process.env.NODE_ENV === 'development') {
      console.log('[prefetch] initiating fetch from', start);
    }
    isLoadingRef.current = true;
    setIsLoadingLines(true);
  try {
      const remaining = meta.numberOfLines - start;
      const toFetch = Math.min(LINES_PER_CHUNK, remaining);
      const res = await fetchFileLines(fileName, userId, start, meta.numberOfLines, toFetch);
      const text = res.text || '';
      let newLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      if (newLines.length && newLines[newLines.length - 1] === '') newLines.pop();
      if (!newLines.length) {
        nextLineRef.current = meta.numberOfLines;
        setNextLineToLoad(meta.numberOfLines);
        return;
      }
      setDocContent(prev => {
        const combined = start === 0 ? newLines : [...prev, ...newLines];
        // Trim head if buffer grows too large
        if (combined.length > MAX_BUFFER_LINES) {
          const overflow = combined.length - MAX_BUFFER_LINES;
          const trimmed = combined.slice(overflow);
          windowStartRef.current += overflow;
          setWindowStart(windowStartRef.current);
          // Adjust stored viewport (global indices shift down by overflow)
          if (lastViewportRef.current.last !== -1) {
            lastViewportRef.current = {
              first: lastViewportRef.current.first + overflow,
              last: lastViewportRef.current.last + overflow,
            };
          }
          if (process.env.NODE_ENV === 'development') {
            console.log('[virtual-window] trimmed', overflow, 'new windowStart', windowStartRef.current, 'buffer size', trimmed.length);
          }
          return trimmed;
        }
        return combined;
      });
      const newGlobalNext = start + newLines.length;
      nextLineRef.current = newGlobalNext;
      setNextLineToLoad(newGlobalNext);
      if (process.env.NODE_ENV === 'development') {
        console.log('[stream] fetched lines', start, '->', newGlobalNext, 'of', meta.numberOfLines);
      }
    } catch (e) {
      const status = e?.response?.status;
      console.error('Failed to load lines', e);
      if (status === 500) {
        const entry = retryMapRef.current[start] || { attempts: 0, nextDelayMs: 500 };
        entry.attempts += 1;
        if (entry.attempts > 5) {
          setFetchError({ message: `Server error at line ${start}. Gave up after ${entry.attempts - 1} retries.`, atLine: start });
        } else {
          // schedule retry with exponential backoff
          const delay = entry.nextDelayMs;
            entry.nextDelayMs = Math.min(entry.nextDelayMs * 2, 8000);
          retryMapRef.current[start] = entry;
          setTimeout(() => {
            if (!isLoadingRef.current && fileName === currentServerFile?.fileName && nextLineRef.current === start) {
              loadMoreLines(fileName, meta);
            }
          }, delay);
        }
      } else {
        setFetchError({ message: `Fetch failed at line ${start}: ${e.message || 'unknown error'}`, atLine: start });
      }
    } finally {
      isLoadingRef.current = false;
      setIsLoadingLines(false);
  // Bootstrap disabled (single initial chunk only); subsequent loads driven by viewport / fallback interval
    }
  }, [fileMeta, userId, currentServerFile]);

  const adaptiveBootstrap = useCallback((meta, fileName) => {
    // Only ensure minimal scrollability once; do not chain indefinitely
    if (!editorApiRef.current || !editorApiRef.current.getViewportInfo) return;
    const info = editorApiRef.current.getViewportInfo();
    if (!info) return;
    const needLines = info.capacity + 5; // small buffer just beyond viewport
    if (docContent.length < needLines && nextLineRef.current < meta.numberOfLines) {
      if (!isLoadingRef.current) {
        loadMoreLines(fileName, meta);
      }
    }
  }, [docContent.length, loadMoreLines]);

  // Viewport driven prefetch (bottom) & optional backward fetch (not yet enabled)
  const handleViewportChange = useCallback(({ firstVisibleLine, lastVisibleLine, cause, capacity }) => {
    if (!fileMeta || !currentServerFile) 
    {
      console.log('[handleViewportChange] not entered, fileMeta = ', fileMeta, 'currentServerFile = ', currentServerFile);
      return;
    }
    else {
      console.log('[handleViewportChange] entered');
    }

    // firstVisibleLine / lastVisibleLine already include lineNumberOffset (global indexes)
    const globalFirst = firstVisibleLine;
    const globalLast = lastVisibleLine;
  lastViewportRef.current = { first: globalFirst, last: globalLast };
    if (process.env.NODE_ENV === 'development') {
      console.log('[viewport]', { globalFirst, globalLast, loadedEnd: nextLineRef.current, windowStart: windowStartRef.current });
    }
  // Bottom prefetch (only on actual user scroll events)
    const loadedEnd = nextLineRef.current; // exclusive
    const cap = capacity || (lastVisibleLine - firstVisibleLine + 1) || 50;
  const userScrolled = cause === 'scroll' && globalLast > lastGlobalLastRef.current;
  if (userScrolled) lastGlobalLastRef.current = globalLast;
    const distanceAhead = (loadedEnd - 1) - globalLast; // lines ahead of viewport
    if (process.env.NODE_ENV === 'development' && cause === 'scroll') {
      console.log('[scroll-eval]', { globalLast, loadedEnd, distanceAhead, cap, threshold: PREFETCH_AHEAD });
    }
    if (loadedEnd < fileMeta.numberOfLines && userScrolled && distanceAhead < PREFETCH_AHEAD) {
      if (process.env.NODE_ENV === 'development') console.log('[prefetch-trigger] threshold');
      loadMoreLines(currentServerFile.fileName, fileMeta);
    }
    // (Future) Top prefetch for backward scrolling if we trimmed
    if (ENABLE_BACKWARD_FETCH && windowStartRef.current > 0 && (globalFirst - TOP_PREFETCH_MARGIN) <= windowStartRef.current) {
      // TODO: implement backward fetch (prepend) logic
    }
  }, [fileMeta, currentServerFile, loadMoreLines]);

  // Fallback: if page scrolls (outer document, not Monaco internal) and Monaco didn't emit scroll events
  useEffect(() => {
    if (!currentServerFile || !fileMeta) return;
    // (Reverted) window scroll fallback removed
  }, [currentServerFile, fileMeta, loadMoreLines]);
  // (Reverted) polling fallback removed

  // Guarded fallback interval: only active if user viewport is near bottom of loaded region
  useEffect(() => {
    if (!currentServerFile || !fileMeta) return;
    const id = setInterval(() => {
      const { last } = lastViewportRef.current;
      if (last === -1) return; // no viewport yet
      const loadedEnd = nextLineRef.current; // exclusive
      if (loadedEnd >= fileMeta.numberOfLines) return; // finished
      if (last + BOTTOM_PREFETCH_MARGIN >= loadedEnd - 1 && !isLoadingRef.current) {
        loadMoreLines(currentServerFile.fileName, fileMeta);
      }
    }, 1200);
    return () => clearInterval(id);
  }, [currentServerFile, fileMeta, loadMoreLines]);
  // (Removed aggressive fallback interval that caused whole-file loading). If needed later, reintroduce with a guard.

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="layout-row">
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <DocumentSelector
              documents={exampleDocuments}
              selectedIdx={selectedDocIdx}
              onSelect={handleDocumentSelect}
              serverEntries={serverEntries}
              onSelectServer={handleServerFileSelect}
              currentServerIndex={currentServerIndex}
            />
            {loadingFiles && <span style={{ fontSize: '0.7rem', color: 'var(--text-soft)' }}>Loading…</span>}
            {currentServerFile && fileMeta && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem', color: 'var(--text-soft)' }}>
                <span>{nextLineToLoad}/{fileMeta.numberOfLines} lines</span>
                {isLoadingLines && <span>…</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Font</span>
              <select
                value={fontSize}
                onChange={e => setFontSize(parseInt(e.target.value, 10))}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '0.85rem'
                }}
              >
                {[12, 13, 14, 15, 16, 18, 20, 22, 24].map(s => <option key={s} value={s}>{s}px</option>)}
              </select>
            </label>
          </div>
          <button className="analyse-btn">Analyse</button>
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle dark mode"
          >{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</button>
        </div>
      </header>
      <div className="highlight-selector-wrapper layout-row">
        {fetchError && (
          <div style={{ background: 'var(--warning-bg, #553)', color: '#ffb', padding: '6px 10px', borderRadius: 6, fontSize: '0.75rem', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>{fetchError.message}</span>
            <button
              style={{ fontSize: '0.7rem', padding: '4px 8px' }}
              onClick={() => {
                setFetchError(null);
                // Retry from failed point if still selected file
                if (currentServerFile && !isLoadingRef.current) {
                  // ensure pointer stays at failed start
                  if (typeof fetchError.atLine === 'number') {
                    nextLineRef.current = fetchError.atLine;
                    setNextLineToLoad(fetchError.atLine);
                  }
                  loadMoreLines(currentServerFile.fileName, fileMeta);
                }
              }}
            >Retry</button>
          </div>
        )}
        <HighlightSelector
          highlightTypes={highlightTypes}
          active={activeHighlights}
          onToggle={handleHighlightToggle}
          onRemove={removeHighlightGroup}
          onCreateGroup={handleCreateGroupFromSelection}
          showColorManager={showColorManager}
          onToggleColors={() => setShowColorManager(v => !v)}
        />
        {process.env.NODE_ENV === 'development' && currentServerFile && fileMeta && (
          <button style={{ marginLeft: 12, fontSize: '0.7rem' }} onClick={() => loadMoreLines(currentServerFile.fileName, fileMeta)} disabled={isLoadingLines}>Dev Load Next</button>
        )}
      </div>
      {showColorManager && (
        <section className="color-manager-panel">
          <div className="color-manager-inner layout-row">
            <h4>Highlight Colors</h4>
            <ul>
              {highlightTypes.map(ht => (
                <li key={ht.type} className="color-row">
                  <span className="color-label">{ht.label}</span>
                  <input
                    type="color"
                    className="color-input"
                    value={/^#[0-9a-fA-F]{6}$/.test(ht.color) ? ht.color : '#cccccc'}
                    title={`Pick color for ${ht.label}`}
                    onChange={(e) => updateHighlightColor(ht.type, e.target.value)}
                  />
                  <input
                    className="color-text-input"
                    value={ht.color}
                    aria-label={`Color hex for ${ht.label}`}
                    onChange={(e) => updateHighlightColor(ht.type, e.target.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    <main className="editor-main">
  <div className="layout-row" style={{ alignItems: 'stretch', gap: '3px' }}>
          <Editor
            content={docContent}
            setContent={setDocContent}
            highlights={highlights.map(h => {
              // Rebase highlight lines relative to current window
              const wl = h.line - windowStart;
              if (wl < 0 || wl >= docContent.length) return null;
              return { ...h, line: wl };
            }).filter(Boolean)}
            highlightTypes={highlightTypes}
            theme={theme}
            fontSize={fontSize}
            lineNumberOffset={windowStart}
            onViewportChange={handleViewportChange}
            onRegisterApi={(api) => { editorApiRef.current = api; }}
          />
          <MiniMap
            content={docContent}
            highlights={highlights}
            highlightTypes={highlightTypes}
            width={minimapWidth}
            onResizeWidth={setMinimapWidth}
            theme={theme}
            onNavigate={(line) => {
              if (editorApiRef.current && editorApiRef.current.setCursorToLine) {
                editorApiRef.current.setCursorToLine(line);
              }
            }}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
