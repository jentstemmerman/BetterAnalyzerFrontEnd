import React from 'react';

function HighlightSelector({ highlightTypes, active, onToggle }) {
  return (
    <div className="highlight-selector">
      {highlightTypes.map(ht => (
        <button
          key={ht.type}
          className={`highlight-btn${active.includes(ht.type) ? ' active' : ''}`}
          style={{ borderColor: ht.color, color: ht.color }}
          onClick={() => onToggle(ht.type)}
        >
          {ht.label}
        </button>
      ))}
    </div>
  );
}

export default HighlightSelector;
