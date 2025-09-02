import React from 'react';

function DocumentSelector({ documents, selectedIdx, onSelect }) {
  return (
    <div className="document-selector">
      <select
        value={selectedIdx}
        onChange={e => onSelect(Number(e.target.value))}
        className="doc-select"
      >
        {documents.map((doc, idx) => (
          <option key={doc.name} value={idx}>{doc.name}</option>
        ))}
      </select>
    </div>
  );
}

export default DocumentSelector;
