import React from 'react';

function HighlightSelector({ highlightTypes, active, onToggle, onRemove, onCreateGroup, showColorManager, onToggleColors, hitCounts, totalLines }) {
  return (
    <div className="highlight-selector">
      {highlightTypes.map(ht => {
        const isActive = active.includes(ht.type);
        const removable = true;
        const displayLabel = (ht.label || '')
          .replace(/^Simularities_/i, '')
          .replace(/\.dat$/i, '');
        const counts = hitCounts && hitCounts[ht.type];
        const intervalCount = counts ? counts.intervals : 0;
        const lineCount = counts ? counts.lines : 0;
        const pct = totalLines > 0 ? ((lineCount / totalLines) * 100).toFixed(1) : '0.0';
        const tooltipText = intervalCount > 0
          ? `${displayLabel} — ${intervalCount.toLocaleString()} occurrence${intervalCount !== 1 ? 's' : ''}, ${lineCount.toLocaleString()} line${lineCount !== 1 ? 's' : ''} (${pct}% of file)`
          : `${displayLabel} — no hits`;
        return (
          <button
            key={ht.type}
            className={`highlight-btn${isActive ? ' active' : ''}`}
            style={{ '--hl-color': ht.color }}
            onClick={() => onToggle(ht.type)}
            title={tooltipText}
          >
            <span className="highlight-label">{displayLabel}</span>
            {intervalCount > 0 && (
              <span className="hit-count-badge">{intervalCount.toLocaleString()}</span>
            )}
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
          title="Show or hide highlight settings (colors & thresholds)"
        >{showColorManager ? 'Hide Settings' : 'Highlight Settings'}</button>
      )}
    </div>
  );
}

export default HighlightSelector;
