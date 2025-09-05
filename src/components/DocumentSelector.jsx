import React from 'react';

// Props:
// documents: fallback example documents
// selectedIdx: index for exampleDocuments selection
// onSelect: handler for example doc selection
// serverEntries: optional array [{fileName,filePath,isDirectory}]
// onSelectServer: handler(entry, idxWithinServerEntries)
function DocumentSelector({ documents, selectedIdx, onSelect, serverEntries = null, onSelectServer, currentServerIndex = -1 }) {
  const hasServer = Array.isArray(serverEntries) && serverEntries.length;

  const handleChange = (e) => {
    const value = e.target.value;
    if (value.startsWith('srv:')) {
      const idx = parseInt(value.slice(4), 10);
      const entry = serverEntries[idx];
      if (entry && onSelectServer) onSelectServer(entry, idx);
    } else {
      onSelect(Number(value));
    }
  };

  const serverFileOptions = hasServer ? serverEntries.filter(e => !e.isDirectory) : [];
  const selectValue = hasServer
    ? (currentServerIndex >= 0 && currentServerIndex < serverFileOptions.length ? `srv:${serverEntries.indexOf(serverFileOptions[currentServerIndex])}` : '')
    : selectedIdx;

  return (
    <div className="document-selector">
      <select value={selectValue} onChange={handleChange} className="doc-select">
        {!hasServer && documents.map((doc, idx) => (
          <option key={doc.name} value={idx}>{doc.name}</option>
        ))}
        {hasServer && currentServerIndex === -1 && <option value="" disabled>Select file…</option>}
        {hasServer && serverFileOptions.map((entry, i) => (
          <option key={entry.filePath} value={`srv:${serverEntries.indexOf(entry)}`}>{entry.fileName}</option>
        ))}
      </select>
    </div>
  );
}

export default DocumentSelector;
