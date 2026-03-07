import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
});

interface MermaidProps {
  chart: string;
  theme?: 'light' | 'dark';
}

const Mermaid: React.FC<MermaidProps> = ({ chart, theme = 'light' }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    });
  }, [theme]);

  useEffect(() => {
    if (ref.current) {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      ref.current.innerHTML = chart;
      try {
        mermaid.render(id, chart).then(({ svg }) => {
          if (ref.current) {
            ref.current.innerHTML = svg;
          }
        });
      } catch (e) {
        console.error('Mermaid render error:', e);
      }
    }
  }, [chart, theme]);

  return <div key={`${chart}-${theme}`} ref={ref} className="mermaid flex justify-center py-4 overflow-x-auto" />;
};

export default Mermaid;
