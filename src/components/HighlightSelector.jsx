import React from 'react';

function HighlightSelector({ highlightTypes, active, onToggle, onRemove, nonRemovable = [] }) {
  return (
    <div className="highlight-selector">
      {highlightTypes.map(ht => {
        const isActive = active.includes(ht.type);
        const removable = !nonRemovable.includes(ht.type);
        return (
          <div key={ht.type} style={{ position: 'relative', display: 'flex' }}>
            <button
              className={`highlight-btn${isActive ? ' active' : ''}`}
              style={{ borderColor: ht.color, color: ht.color, paddingRight: removable ? 28 : 18 }}
              onClick={() => onToggle(ht.type)}
              title={ht.label + (removable ? ' (click to toggle, X to remove)' : '')}
            >
              {ht.label}
            </button>
            {removable && (
              <button
                aria-label={`Remove ${ht.label}`}
                title={`Remove ${ht.label}`}
                onClick={(e) => { e.stopPropagation(); onRemove && onRemove(ht.type); }}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: 4,
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: 'none',
                  background: '#e55353',
                  color: '#fff',
                  fontSize: 12,
                  lineHeight: '18px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default HighlightSelector;
