import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import Editor from './components/Editor';
import MiniMap from './components/MiniMap';
import HighlightSelector from './components/HighlightSelector';
import DocumentSelector from './components/DocumentSelector';

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

  const randomPastel = () => {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h} 90% 80%)`;
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

  return (
    <div className="app-container">
      <header className="app-header">
        <DocumentSelector
          documents={exampleDocuments}
          selectedIdx={selectedDocIdx}
          onSelect={handleDocumentSelect}
        />
        <button className="analyse-btn">Analyse</button>
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle dark mode"
        >{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</button>
      </header>
      <HighlightSelector
        highlightTypes={highlightTypes}
        active={activeHighlights}
        onToggle={handleHighlightToggle}
        onRemove={removeHighlightGroup}
        onCreateGroup={handleCreateGroupFromSelection}
      />
      <main className="editor-main">
        <Editor
          content={docContent}
            setContent={setDocContent}
            highlights={highlights}
            highlightTypes={highlightTypes}
            theme={theme}
            onRegisterApi={(api) => { editorApiRef.current = api; }}
        />
        <MiniMap
          content={docContent}
          highlights={highlights}
          highlightTypes={highlightTypes}
          onNavigate={(line) => {
            if (editorApiRef.current && editorApiRef.current.setCursorToLine) {
              editorApiRef.current.setCursorToLine(line);
            }
          }}
        />
      </main>
    </div>
  );
}

export default App;
