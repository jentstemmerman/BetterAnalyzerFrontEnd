import React, { useState, useCallback } from 'react';

function HighlightSelector({ highlightTypes, active, onToggle, onRemove, onCreateGroup, showColorManager, onToggleColors, hitCounts, totalLines, docIntervals, onNavigateToLine }) {
  // Track current navigation index per highlight type (state so tooltip re-renders)
  const [navIndices, setNavIndices] = useState({});

  const navigateInterval = useCallback((type, direction) => {
    if (!docIntervals || !onNavigateToLine) return;
    const intervals = docIntervals
      .filter(iv => iv.type === type)
      .sort((a, b) => a.lineNumber - b.lineNumber);
    if (intervals.length === 0) return;

    setNavIndices(prev => {
      const prevIdx = prev[type];
      let idx;
      if (prevIdx === undefined || prevIdx === null) {
        idx = direction > 0 ? 0 : intervals.length - 1;
      } else {
        idx = prevIdx + direction;
        if (idx < 0) idx = intervals.length - 1;
        if (idx >= intervals.length) idx = 0;
      }
      onNavigateToLine(intervals[idx].lineNumber);
      return { ...prev, [type]: idx };
    });
  }, [docIntervals, onNavigateToLine]);

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
        const currentIdx = navIndices[ht.type];
        const positionText = (currentIdx !== undefined && currentIdx !== null && intervalCount > 0)
          ? ` — at ${currentIdx + 1} of ${intervalCount.toLocaleString()}`
          : '';
        const tooltipText = intervalCount > 0
          ? `${displayLabel}${positionText}\n${intervalCount.toLocaleString()} occurrence${intervalCount !== 1 ? 's' : ''}, ${lineCount.toLocaleString()} line${lineCount !== 1 ? 's' : ''} (${pct}% of file)`
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
            {intervalCount > 0 && (
              <span className="interval-nav-arrows">
                <span
                  className="interval-nav-arrow"
                  role="button"
                  aria-label={`Previous ${displayLabel} occurrence`}
                  title="Previous occurrence"
                  onClick={(e) => { e.stopPropagation(); navigateInterval(ht.type, -1); }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                    <path d="M2 7 L5 3 L8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </span>
                <span
                  className="interval-nav-arrow"
                  role="button"
                  aria-label={`Next ${displayLabel} occurrence`}
                  title="Next occurrence"
                  onClick={(e) => { e.stopPropagation(); navigateInterval(ht.type, 1); }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                    <path d="M2 3 L5 7 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </span>
              </span>
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
