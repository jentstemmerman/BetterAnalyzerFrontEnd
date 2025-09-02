import React from 'react';

function MiniMap({ content, highlights, highlightTypes, onNavigate }) {
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
            : { background: 'var(--border)', opacity: 0.25 };
          return (
            <div
              key={idx}
              className="minimap-line"
              style={style}
              onClick={() => onNavigate && onNavigate(idx)}
              role={onNavigate ? 'button' : undefined}
              tabIndex={onNavigate ? 0 : undefined}
              aria-label={onNavigate ? `Jump to line ${idx + 1}` : undefined}
              onKeyDown={(e) => {
                if (!onNavigate) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate(idx);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default MiniMap;
