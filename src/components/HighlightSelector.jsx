import React from 'react';

function HighlightSelector({ highlightTypes, active, onToggle, onRemove, onCreateGroup, showColorManager, onToggleColors }) {
  return (
    <div className="highlight-selector">
      {highlightTypes.map(ht => {
        const isActive = active.includes(ht.type);
  const removable = true;
        return (
          <button
            key={ht.type}
            className={`highlight-btn${isActive ? ' active' : ''}`}
            style={{ '--hl-color': ht.color }}
            onClick={() => onToggle(ht.type)}
            title={ht.label + (removable ? ' (toggle / delete)' : '')}
          >
            <span className="highlight-label">{ht.label}</span>
            {removable && (
              <span
                className="remove-highlight-icon"
                role="button"
                aria-label={`Remove ${ht.label}`}
                onClick={(e) => { e.stopPropagation(); onRemove && onRemove(ht.type); }}
              >
                <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                  <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
      {onCreateGroup && (
        <button
          className="create-group-btn"
          onClick={onCreateGroup}
          title="Create a new highlight group from the current selection"
        >+ Create Group</button>
      )}
      {onToggleColors && (
        <button
          className="toggle-colors-btn"
          aria-expanded={showColorManager}
          onClick={onToggleColors}
          title="Show / hide highlight color editor"
        >{showColorManager ? 'Hide Colors' : 'Edit Colors'}</button>
      )}
    </div>
  );
}

export default HighlightSelector;
