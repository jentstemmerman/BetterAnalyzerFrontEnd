import React from 'react';

function HighlightSelector({ highlightTypes, active, onToggle, onRemove }) {
  return (
    <div className="highlight-selector">
      {highlightTypes.map(ht => {
        const isActive = active.includes(ht.type);
  const removable = true;
        return (
          <button
            key={ht.type}
            className={`highlight-btn${isActive ? ' active' : ''}`}
            style={{
              borderColor: ht.color,
              color: ht.color,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onClick={() => onToggle(ht.type)}
            title={ht.label + (removable ? ' (click to toggle, X to remove)' : '')}
          >
            <span>{ht.label}</span>
            {removable && (
              <span
                role="button"
                aria-label={`Remove ${ht.label}`}
                onClick={(e) => { e.stopPropagation(); onRemove && onRemove(ht.type); }}
                style={{
                  background: '#e55353',
                  color: '#fff',
                  borderRadius: '4px',
                  padding: '0 6px',
                  fontSize: '0.75rem',
                  lineHeight: '1.1rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >×</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default HighlightSelector;
