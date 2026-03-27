import type { CSSProperties } from 'react';

export const glassPanel: CSSProperties = {
  background: 'rgba(255,255,255,0.14)',
  backdropFilter: 'blur(36px) saturate(160%)',
  WebkitBackdropFilter: 'blur(36px) saturate(160%)',
  border: '1px solid rgba(255,255,255,0.28)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.45)',
};

export const glassSummary: CSSProperties = {
  background: 'rgba(255,255,255,0.22)',
  backdropFilter: 'blur(24px) saturate(150%)',
  WebkitBackdropFilter: 'blur(24px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.35)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.50)',
};

export const glassHeader: CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  backdropFilter: 'blur(24px) saturate(140%)',
  WebkitBackdropFilter: 'blur(24px) saturate(140%)',
  borderBottom: '1px solid rgba(255,255,255,0.15)',
};
