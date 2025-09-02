import React, { useState } from 'react';
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
      'Enjoy your professional editor!'
    ],
    highlights: [
      { line: 2, type: 'info' },
      { line: 3, type: 'warning' },
      { line: 4, type: 'success' }
    ]
  }
];

const highlightTypes = [
  { type: 'info', label: 'Info', color: '#4F8EF7' },
  { type: 'warning', label: 'Warning', color: '#F7B32B' },
  { type: 'success', label: 'Success', color: '#4FCF7F' }
];

function App() {
  const [selectedDocIdx, setSelectedDocIdx] = useState(0);
  const [activeHighlights, setActiveHighlights] = useState(highlightTypes.map(ht => ht.type));
  const [docContent, setDocContent] = useState(exampleDocuments[0].content);

  const handleHighlightToggle = (type) => {
    setActiveHighlights(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleDocumentSelect = (idx) => {
    setSelectedDocIdx(idx);
    setDocContent(exampleDocuments[idx].content);
  };

  const highlights = exampleDocuments[selectedDocIdx].highlights.filter(h => activeHighlights.includes(h.type));

  return (
    <div className="app-container">
      <header className="app-header">
        <DocumentSelector
          documents={exampleDocuments}
          selectedIdx={selectedDocIdx}
          onSelect={handleDocumentSelect}
        />
        <button className="analyse-btn">Analyse</button>
      </header>
      <HighlightSelector
        highlightTypes={highlightTypes}
        active={activeHighlights}
        onToggle={handleHighlightToggle}
      />
      <main className="editor-main">
        <Editor
          content={docContent}
          setContent={setDocContent}
          highlights={highlights}
          highlightTypes={highlightTypes}
        />
        <MiniMap
          content={docContent}
          highlights={exampleDocuments[selectedDocIdx].highlights}
          highlightTypes={highlightTypes}
        />
      </main>
    </div>
  );
}

export default App;
