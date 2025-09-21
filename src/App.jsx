import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import Editor from './components/Editor';
import MiniMap from './components/MiniMap';
import HighlightSelector from './components/HighlightSelector';
import DocumentSelector from './components/DocumentSelector';
import { GetServerDirectoryListing, getMetadata, fetchFileLines, AnalyzeFile } from './api/library';

const exampleDocuments = [
  {
    name: 'Empty Document',
    content: [
      'Open a log file',
    ],
    highlights: []
  }
];

// Start with no predefined highlight groups; they are created dynamically (similarities or user selections)
const baseHighlightTypes = [];

function App() {
  const [selectedDocIdx, setSelectedDocIdx] = useState(0);
  const [highlightTypes, setHighlightTypes] = useState(baseHighlightTypes);
  const [activeHighlights, setActiveHighlights] = useState([]);
  const [docContent, setDocContent] = useState(exampleDocuments[0].content);
  const [docHighlights, setDocHighlights] = useState([]);
  const [groupCounter, setGroupCounter] = useState(1);
  const [theme, setTheme] = useState(() => (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [fontSize, setFontSize] = useState(14);
  const [showColorManager, setShowColorManager] = useState(false);
  const [minimapWidth, setMinimapWidth] = useState(15);
  const [serverEntries, setServerEntries] = useState([]); // array of {fileName,filePath,isDirectory}
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [userId] = useState(0); // TODO: replace with real user context
  const [currentServerFile, setCurrentServerFile] = useState(null); // entry object
  const [currentServerIndex, setCurrentServerIndex] = useState(-1);
  const [fileMeta, setFileMeta] = useState(null); // { size, numberOfLines }
  const [nextLineToLoad, setNextLineToLoad] = useState(0);
  const [isLoadingLines, setIsLoadingLines] = useState(false);
  const [useVirtual, setUseVirtual] = useState(false); // enable monaco viewport-driven loading
  const [analyzeStatus, setAnalyzeStatus] = useState({ running: false, progress: null, file: null, error: null });
  const fileLoadIdRef = React.useRef(0);
  const nextLineRef = React.useRef(0);
  const isLoadingRef = React.useRef(false);
  const LINES_PER_CHUNK = 10000;
  // Default similarity threshold (used when a highlight group doesn't have its own)
  const DEFAULT_SIMILARITY_THRESHOLD = -0.8;
  // Map similarity name -> highlight type key (stable per file)
  const simTypeMapRef = React.useRef(new Map());
  // Store raw similarity score arrays per similarity group name (value: { type, scores: number[], totalLines })
  const similarityScoresRef = React.useRef(new Map());

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
  setDocHighlights([]);
  setHighlightTypes([]);
  setActiveHighlights([]);
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
  const newType = { type, label: name, color, threshold: DEFAULT_SIMILARITY_THRESHOLD, origin: 'manual' };
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

  // Update per-group similarity threshold; expects numeric value (more negative = stricter)
  const updateHighlightThreshold = useCallback((type, value) => {
    if (value === '' || value === null || value === undefined) return;
    let num = Number(value);
    if (Number.isNaN(num) || !Number.isFinite(num)) return;
    // Clamp to a reasonable range for similarity scores
    if (num > 1) num = 1;
    if (num < -1) num = -1;
    setHighlightTypes(prev => prev.map(ht => ht.type === type ? { ...ht, threshold: num } : ht));
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

  // Ensure a similarity group exists for a name and return its type key
  const ensureSimilarityType = useCallback((name) => {
    const key = (typeof name === 'string' && name.trim()) ? name.trim() : 'similarity';
    const existing = simTypeMapRef.current.get(key);
    if (existing) return existing;
    // Generate a unique type slug against current highlightTypes
    const slugBase = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'similarity';
    const used = new Set(highlightTypes.map(h => h.type));
    let slug = slugBase;
    let i = 1;
    while (used.has(slug)) slug = `${slugBase}-${i++}`;
    const color = randomPastel();
  const newType = { type: slug, label: key, color, threshold: DEFAULT_SIMILARITY_THRESHOLD, origin: 'similarity' };
    // Record mapping first to avoid races from concurrent chunk loads
    simTypeMapRef.current.set(key, slug);
    // Register new highlight type BUT do NOT auto-enable.
    // This change ensures that when a new file loads, all similarity-derived
    // highlight groups start disabled by default until the user explicitly toggles them.
    setHighlightTypes(prev => [...prev, newType]);
    return slug;
  }, [highlightTypes]);

  // Process similarities for a fetched chunk and add matching highlights
  const processSimilarityChunk = useCallback((simularities, startIndex, length, meta) => {
    if (!Array.isArray(simularities) || !simularities.length || !Number.isInteger(startIndex) || length <= 0) return;
    const totalLines = meta?.numberOfLines;
    const pendingAdds = [];
    for (const s of simularities) {
      const name = s.name ?? s.simularity_file ?? 'similarity';
      const arr = s.simularities ?? s.values ?? s.scores ?? s.array ?? s.floats;
      if (!Array.isArray(arr) || !arr.length) continue;
      const type = ensureSimilarityType(name);
      // Determine threshold for this type (fallback to default)
      const typeThreshold = (highlightTypes.find(h => h.type === type)?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD);
      // Persist full score array (only once) if it matches totalLines; else merge chunk region.
      if (Number.isInteger(totalLines)) {
        const entry = similarityScoresRef.current.get(type) || { type, scores: new Array(totalLines).fill(null), totalLines };
        // Fill the region represented by this chunk.
        for (let i = 0; i < length; i++) {
          const idx = (Number.isInteger(totalLines) && arr.length === totalLines) ? (startIndex + i) : (startIndex + i);
          // Guard index
          if (idx >= 0 && idx < entry.scores.length) {
            const val = arr[(arr.length === totalLines) ? idx : i];
            if (typeof val === 'number' && entry.scores[idx] == null) entry.scores[idx] = val;
          }
        }
        similarityScoresRef.current.set(type, entry);
      }
      const useWholeFile = Number.isInteger(totalLines) && arr.length === totalLines;
      for (let i = 0; i < length; i++) {
        const idx = useWholeFile ? (startIndex + i) : i;
        const v = arr[idx];
        if (typeof v === 'number' && v < typeThreshold) {
          pendingAdds.push({ line: startIndex + i, type });
        }
      }
    }
    if (!pendingAdds.length) return;
    setDocHighlights(prev => {
      if (!prev || !prev.length) return [...pendingAdds];
      const have = new Set(prev.map(h => `${h.line}:${h.type}`));
      const filtered = pendingAdds.filter(h => !have.has(`${h.line}:${h.type}`));
      return filtered.length ? [...prev, ...filtered] : prev;
    });
  }, [ensureSimilarityType, highlightTypes]);

  // Retroactively recompute highlights for a given similarity type based on stored scores & current threshold
  const recomputeSimilarityType = useCallback((type) => {
    const ht = highlightTypes.find(h => h.type === type);
    if (!ht) return;
    const data = similarityScoresRef.current.get(type);
    if (!data || !Array.isArray(data.scores) || !data.scores.length) return;
    const threshold = typeof ht.threshold === 'number' ? ht.threshold : DEFAULT_SIMILARITY_THRESHOLD;
    const additions = [];
    for (let i = 0; i < data.scores.length; i++) {
      const v = data.scores[i];
      if (typeof v === 'number' && v < threshold) additions.push({ line: i, type });
    }
    setDocHighlights(prev => {
      // Remove existing highlights for this type first, then add recomputed set
      const filteredPrev = prev.filter(h => h.type !== type);
      // De-duplicate additions for safety
      const seen = new Set();
      const dedup = [];
      for (const a of additions) {
        const key = a.line;
        if (!seen.has(key)) { seen.add(key); dedup.push(a); }
      }
      return [...filteredPrev, ...dedup];
    });
  }, [highlightTypes]);

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
  setHighlightTypes([]);
  setActiveHighlights([]);
    // Reset similarity mapping per new file
    simTypeMapRef.current = new Map();
    similarityScoresRef.current = new Map();
    setFileMeta(null);
    setNextLineToLoad(0);
    setUseVirtual(false);
    nextLineRef.current = 0;
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
      // Decide virtualization: enable if file larger than one chunk (or always true if desired)
      const shouldVirtualize = meta.numberOfLines > LINES_PER_CHUNK; // heuristic
      setUseVirtual(shouldVirtualize);
      if (shouldVirtualize) {
        // In virtual mode don't eagerly load lines; editor will fetch on demand
        setDocContent([]); // keep empty; virtual model supplies blank lines
      } else {
        await loadMoreLines(entry.fileName, meta, loadIdSnapshot);
      }
    } catch (e) {
      setDocContent([`Error loading file ${entry.fileName}`]);
    }
  };

  const loadMoreLines = useCallback(async (fileName, metaOverride = null, loadIdOverride = null) => {
    console.log('loadMoreLines called');
    
    if (isLoadingRef.current) return; // prevent overlap
    const meta = metaOverride || fileMeta;
    if (!meta) return;
    const start = nextLineRef.current;
    if (start >= meta.numberOfLines) return; // done
    
    console.log('loadMoreLines start');
    isLoadingRef.current = true;
    setIsLoadingLines(true);
    let scheduled = false;
    
    try {
      const remaining = meta.numberOfLines - start;
      const toFetch = Math.min(LINES_PER_CHUNK, remaining);

      if (toFetch < LINES_PER_CHUNK) {
        console.log('Final chunk, fetching remaining', remaining);
      }

      const res = await fetchFileLines(fileName, userId, start, meta.numberOfLines, toFetch);
      const text = res.text || '';
      let newLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      if (newLines.length && newLines[newLines.length - 1] === '') 
      {
          newLines.pop();
      }
      if (!newLines.length) {
        nextLineRef.current = meta.numberOfLines;
        setNextLineToLoad(meta.numberOfLines);
        return;
      }
      // Apply similarity-based highlights for this chunk if provided
      try {
        if (res && Array.isArray(res.simularities)) {
          processSimilarityChunk(res.simularities, start, newLines.length, meta);
        }
      } catch (e) {
        console.warn('processSimilarityChunk failed (non-virtual)', e);
      }
      setDocContent(prev => (start === 0 ? newLines : [...prev, ...newLines]));
      const newStart = start + newLines.length;
      nextLineRef.current = newStart;
      setNextLineToLoad(newStart);
      const activeLoadId = loadIdOverride ?? fileLoadIdRef.current;
    if (!useVirtual && newStart < meta.numberOfLines && activeLoadId === fileLoadIdRef.current) {
        scheduled = true;
        console.log('loadMoreLines setTimeout');
        setTimeout(() => {
          if (activeLoadId === fileLoadIdRef.current) {
            loadMoreLines(fileName, meta);
          }
        }, 0);
      }
    } catch (e) {
      console.error('Failed to load lines', e);
    } finally {
      isLoadingRef.current = false;
      if (!scheduled) setIsLoadingLines(false); else setIsLoadingLines(false); // keep indicator simple
    }
     console.log('loadMoreLines end');
  }, [fileMeta, userId, useVirtual]);

  const handleAnalyze = useCallback(async () => {
    // Only allow analysis when a server file is explicitly selected
    if (!currentServerFile || !currentServerFile.fileName) return;
    const targetFile = currentServerFile.fileName;
    if (analyzeStatus.running) return; // prevent duplicate starts
    setAnalyzeStatus({ running: true, progress: { message: 'Starting…', pct: 0 }, file: targetFile, error: null });
    try {
      // Provide a progress callback the websocket handler can call later (once integrated fully)
      const progressCb = (update) => {
        // Expect update shape maybe { pct, message/status, error }
        setAnalyzeStatus(prev => {
          if (!prev.running) return prev;
          const pct = update?.pct;
          const statusText = update?.message || update?.status;
          const isComplete = (typeof pct === 'number' && pct >= 100) || /done|complete|finished/i.test(statusText || '');
          if (update?.error) {
            return { running: false, progress: null, file: prev.file, error: update.error || 'Analysis failed' };
          }
          if (isComplete) {
            // Briefly show 100% then reset to idle state after a short delay
            // Keep internal progress but schedule reset
            setTimeout(() => {
              setAnalyzeStatus(current => current.file === prev.file ? { running: false, progress: null, file: prev.file, error: null } : current);
            }, 600);
            return { ...prev, progress: { ...update, pct: 100, message: statusText || 'Complete' } };
          }
            return { ...prev, progress: update };
        });
      };
      await AnalyzeFile(targetFile, userId, progressCb);
      // Since AnalyzeFile currently returns null immediately, we simulate ongoing progress until websocket events arrive.
    } catch (e) {
      setAnalyzeStatus({ running: false, progress: null, file: targetFile, error: 'Failed to start analysis' });
    }
  }, [currentServerFile, userId, analyzeStatus.running]);

  // Provide a stable handler for virtualized line requests (moved out of JSX)
  const handleRequestLines = useCallback(async (start, end) => {
    try {
      if (!currentServerFile || !fileMeta) return [];
      const len = end - start;
      const res = await fetchFileLines(currentServerFile.fileName, userId, start, fileMeta.numberOfLines, len);
      const text = (res && res.text) ? res.text : '';
      let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      if (lines.length !== len)
        console.error(`onRequestLines failed got ${lines.length} instead of ${len}`);
      // else
      //   console.log(`onRequestLines succeeded got ${lines.length} lines, first line starts with:`, lines[0].slice(0,60));

      if (lines.length && lines[lines.length - 1] === '') 
      {
        console.log(`lines.pop`);
        lines.pop();
      }
      // Process similarity highlights for this virtual chunk
      try {
        if (res && Array.isArray(res.simularities)) {
          processSimilarityChunk(res.simularities, start, lines.length, fileMeta);
        }
      } catch (e) {
        console.warn('processSimilarityChunk failed (virtual)', e);
      }
      return lines;
    } 
    catch (e) {
      console.warn('onRequestLines failed', e);
      return [];
    }
  }, [currentServerFile, fileMeta, userId, processSimilarityChunk]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className={`analyse-btn ${analyzeStatus.running ? 'is-running' : ''} ${analyzeStatus.running && (!analyzeStatus.progress || analyzeStatus.progress.pct == null) ? 'indeterminate' : ''} ${analyzeStatus.running && analyzeStatus.progress?.pct != null ? 'determinate' : ''}`}
              onClick={handleAnalyze}
              disabled={analyzeStatus.running || !currentServerFile}
              aria-busy={analyzeStatus.running || undefined}
              aria-live="polite"
              aria-label={analyzeStatus.running
                ? (analyzeStatus.progress?.pct != null
                    ? `Analysing ${analyzeStatus.progress.pct.toFixed(0)} percent - ${analyzeStatus.progress.message || ''}`
                    : `Analysing - ${analyzeStatus.progress?.message || 'in progress'}`)
                : (!currentServerFile ? 'Select a file to analyse' : 'Analyse file')}
            >
              <span className="btn-progress-label">
                {analyzeStatus.running ? 'Analysing…' : (currentServerFile ? 'Analyse' : 'Analyse')}
              </span>
              {analyzeStatus.running && (
                <span className="btn-progress-track" aria-hidden="true">
                  <span
                    className="btn-progress-fill"
                    style={analyzeStatus.progress?.pct != null ? { width: `${Math.min(100, Math.max(0, analyzeStatus.progress.pct))}%` } : undefined}
                  />
                </span>
              )}
            </button>
            {analyzeStatus.error && !analyzeStatus.running && (
              <span style={{ fontSize: '0.7rem', color: 'var(--danger, #e57373)' }}>{analyzeStatus.error}</span>
            )}
          </div>
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle dark mode"
          >{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</button>
        </div>
      </header>
      <div className="highlight-selector-wrapper layout-row">
        <HighlightSelector
          highlightTypes={highlightTypes}
          active={activeHighlights}
          onToggle={handleHighlightToggle}
          onRemove={removeHighlightGroup}
          onCreateGroup={handleCreateGroupFromSelection}
          showColorManager={showColorManager}
          onToggleColors={() => setShowColorManager(v => !v)}
        />
      </div>
      {showColorManager && (
        <section className="color-manager-panel">
          <div className="color-manager-inner layout-row">
            <h4>Highlight Colors & Thresholds</h4>
            <div className="color-grid" role="table" aria-label="Highlight groups">
              <div className="color-grid-head" role="row">
                <span role="columnheader">Group</span>
                <span role="columnheader">Color</span>
                <span role="columnheader">Hex</span>
                <span role="columnheader">Threshold</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>Actions</span>
              </div>
              {highlightTypes.map(ht => (
                <div key={ht.type} className="color-grid-row" role="row">
                  <span className="cg-label" role="cell">{ht.label}</span>
                  <span role="cell">
                    <input
                      type="color"
                      className="color-input"
                      value={/^#[0-9a-fA-F]{6}$/.test(ht.color) ? ht.color : '#cccccc'}
                      title={`Pick color for ${ht.label}`}
                      onChange={(e) => updateHighlightColor(ht.type, e.target.value)}
                    />
                  </span>
                  <span role="cell">
                    <input
                      className="color-text-input"
                      value={ht.color}
                      aria-label={`Color hex for ${ht.label}`}
                      onChange={(e) => updateHighlightColor(ht.type, e.target.value)}
                    />
                  </span>
                  <span role="cell">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      className="color-text-input threshold-input"
                      value={(() => { const t = typeof ht.threshold === 'number' ? ht.threshold : DEFAULT_SIMILARITY_THRESHOLD; return Math.abs(t); })()}
                      aria-label={`Similarity threshold magnitude for ${ht.label}`}
                      title="Similarity match threshold (positive magnitude). Actual match if score < -value. Range 0..1."
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '' ) return; // ignore empty
                        const mag = Math.max(0, Math.min(1, Number(raw)));
                        if (!Number.isFinite(mag)) return;
                        // store as negative value internally
                        updateHighlightThreshold(ht.type, -mag);
                      }}
                    />
                  </span>
                  <span role="cell" className="cg-actions">
                    {ht.origin === 'similarity' && (
                      <button
                        type="button"
                        className="apply-btn"
                        onClick={() => recomputeSimilarityType(ht.type)}
                        title="Recompute highlights for this similarity group using current threshold"
                      >Apply↻</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p style={{ width: '100%', fontSize: '0.65rem', color: 'var(--text-soft)', marginTop: 8 }}>
              Threshold now shown as a positive magnitude (0..1). Internally a score matches when raw similarity &lt; -magnitude. Changing a value does not auto re-filter; use Apply↻ to recompute.
            </p>
          </div>
        </section>
      )}
    <main className="editor-main">
  <div className="layout-row" style={{ alignItems: 'stretch', gap: '3px' }}>
          {/* Performance tuning: smaller virtualChunkSize lowers per-fetch payload -> smoother scroll at cost of more requests */}
          <Editor
            content={docContent}
            setContent={setDocContent}
            highlights={highlights}
            highlightTypes={highlightTypes}
            theme={theme}
            fontSize={fontSize}
            onRegisterApi={(api) => { editorApiRef.current = api; }}
            virtualFileMeta={useVirtual && currentServerFile && fileMeta ? fileMeta : null}
            onRequestLines={useVirtual && currentServerFile && fileMeta ? handleRequestLines : null}
            virtualChunkSize={10000}
            virtualPreload={5000}
            virtualPlaceholderLines={useVirtual && fileMeta ? fileMeta.numberOfLines : null}
          />
          <MiniMap
            content={docContent}
            highlights={highlights}
            highlightTypes={highlightTypes}
            width={minimapWidth}
            onResizeWidth={setMinimapWidth}
            theme={theme}
            totalLines={useVirtual && fileMeta ? fileMeta.numberOfLines : docContent.length}
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
