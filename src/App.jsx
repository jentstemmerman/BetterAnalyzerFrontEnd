import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import Editor from './components/Editor';
import MiniMap from './components/MiniMap';
import HighlightSelector from './components/HighlightSelector';
import DocumentSelector from './components/DocumentSelector';
import { GetServerDirectoryListing } from './api/library';

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
    // For now re-use example content placeholder until file fetching is implemented.
    setSelectedDocIdx(idx);
    setDocContent([`Selected file: ${entry.filePath}`, 'File loading not implemented yet.']);
    setDocHighlights([]);
    setHighlightTypes(baseHighlightTypes);
    setActiveHighlights(baseHighlightTypes.map(ht => ht.type));
  };

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
            />
            {loadingFiles && <span style={{ fontSize: '0.7rem', color: 'var(--text-soft)' }}>Loading…</span>}
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
              highlights={highlights}
              highlightTypes={highlightTypes}
              theme={theme}
              fontSize={fontSize}
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
