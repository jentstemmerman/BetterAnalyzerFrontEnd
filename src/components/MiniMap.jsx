import React, { useRef, useState, useEffect, useCallback } from 'react';

const MIN_MINIMAP_WIDTH = 12; // even slimmer
const MAX_MINIMAP_WIDTH = 240; // allow a bit wider if user wants

function MiniMap({ content, highlights, highlightTypes, onNavigate, width = 60, onResizeWidth, theme }) {
  // Map line numbers to highlight type
  const highlightMap = {};
  highlights.forEach(h => {
    highlightMap[h.line] = h.type;
  });

  const containerRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startWidth: width });
  const [internalWidth, setInternalWidth] = useState(width);

  // Sync external width prop to internal state
  useEffect(() => { setInternalWidth(width); }, [width]);

  const onMouseMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active) return;
    const delta = e.clientX - d.startX;
    const newW = Math.min(MAX_MINIMAP_WIDTH, Math.max(MIN_MINIMAP_WIDTH, d.startWidth + delta));
    setInternalWidth(newW);
    if (onResizeWidth) onResizeWidth(newW);
  }, [onResizeWidth]);

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', endDrag);
  }, [onMouseMove]);

  const startDrag = (e) => {
    dragRef.current = { active: true, startX: e.clientX, startWidth: internalWidth };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  };

  useEffect(() => () => { // cleanup on unmount
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', endDrag);
  }, [onMouseMove, endDrag]);

  const lineCount = content.length || 1;
  return (
    <div
      className="minimap-container"
      aria-label="Document minimap"
      ref={containerRef}
      style={{ width: internalWidth, minWidth: internalWidth }}
    >
      <div className="minimap minimap-abs" style={{ width: '100%', position: 'relative' }}>
        {content.map((_, idx) => {
          const type = highlightMap[idx];
          const baseColor = type
            ? highlightTypes.find(ht => ht.type === type).color
            : (theme === 'light' ? '#ffffff' : 'var(--border)');
          const topPct = (idx / lineCount) * 100;
          const heightPct = (1 / lineCount) * 100;
          return (
            <div
              key={idx}
              className="minimap-line"
              style={{
                position: 'absolute',
                top: `${topPct}%`,
                height: `${heightPct}%`,
                left: 0,
                right: 0,
                background: baseColor,
                opacity: type ? 0.7 : 0.25
              }}
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
      <div
        className="minimap-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize minimap"
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            const nw = Math.max(MIN_MINIMAP_WIDTH, internalWidth - 5); setInternalWidth(nw); onResizeWidth && onResizeWidth(nw);
          } else if (e.key === 'ArrowRight') {
            const nw = Math.min(MAX_MINIMAP_WIDTH, internalWidth + 5); setInternalWidth(nw); onResizeWidth && onResizeWidth(nw);
          }
        }}
      />
    </div>
  );
}

export default MiniMap;
