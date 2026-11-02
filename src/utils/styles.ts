import type { CSSProperties } from 'react';
import { themed } from '../design/tokens';

const LINE = themed('rgba(0,0,0,0.06)', 'rgba(236,236,232,0.10)');

export const glassPanel: CSSProperties = {
  background: themed('rgba(255,255,255,0.88)', 'rgba(28,28,30,0.92)'),
  border: `1px solid ${LINE}`,
  boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
};

export const glassSummary: CSSProperties = {
  background: themed('rgba(255,255,255,0.92)', 'rgba(28,28,30,0.94)'),
  border: `1px solid ${LINE}`,
  boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
};

export const glassHeader: CSSProperties = {
  background: themed('rgba(255,255,255,0.94)', 'rgba(28,28,30,0.96)'),
  borderBottom: `1px solid ${LINE}`,
  boxShadow: '0 1px 8px rgba(0,0,0,0.03)',
};
