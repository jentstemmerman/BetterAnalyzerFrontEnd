import React from 'react';

function MiniMap({ content, highlights, highlightTypes }) {
  // Map line numbers to highlight type
  const highlightMap = {};
  highlights.forEach(h => {
    highlightMap[h.line] = h.type;
  });

  return (
    <div className="minimap-container" aria-label="Document minimap">
      <div className="minimap">
        {content.map((_, idx) => {
          const type = highlightMap[idx];
          const style = type
            ? { background: highlightTypes.find(ht => ht.type === type).color, opacity: 0.7 }
            : { background: '#eee', opacity: 0.3 };
          return <div key={idx} className="minimap-line" style={style} />;
        })}
      </div>
    </div>
  );
}

export default MiniMap;
