import type { ThemeName } from './types';

export interface Theme {
  bg: string;
  grid: string;
  axis: string;
  axisLabel: string;
  obstacle: string;
  obstacleFill: string;
  panel: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
  accent2: string;
  danger: string;
  target: string;
  bullet: string;
  waveCore: string;
  waveMid: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    bg: '#000000',
    grid: 'rgba(44, 201, 255, 0.06)',
    axis: 'rgba(44, 201, 255, 0.32)',
    axisLabel: 'rgba(44, 201, 255, 0.5)',
    obstacle: 'rgba(157, 107, 255, 0.75)',
    obstacleFill: 'rgba(157, 107, 255, 0.10)',
    panel: 'rgba(20, 20, 24, 0.94)',
    border: '#2a2a32',
    text: '#ebebeb',
    dim: '#8a8a93',
    accent: '#2cc9ff',
    accent2: '#a2db3c',
    danger: '#ff3b5c',
    target: '#ff2bd6',
    bullet: '#ffffff',
    waveCore: 'rgba(44, 201, 255, 0.10)',
    waveMid: 'rgba(44, 201, 255, 0.04)',
  },
  light: {
    bg: '#f5f4f2',
    grid: 'rgba(150, 20, 40, 0.07)',
    axis: 'rgba(150, 20, 40, 0.4)',
    axisLabel: 'rgba(120, 20, 35, 0.6)',
    obstacle: 'rgba(111, 63, 209, 0.7)',
    obstacleFill: 'rgba(111, 63, 209, 0.08)',
    panel: 'rgba(255, 255, 255, 0.95)',
    border: '#d8d6d2',
    text: '#16161a',
    dim: '#5c5c66',
    accent: '#d91f3c',
    accent2: '#4a7a12',
    danger: '#a31225',
    target: '#c217a3',
    bullet: '#16161a',
    waveCore: 'rgba(217, 31, 60, 0.19)',
    waveMid: 'rgba(217, 31, 60, 0.07)',
  },
};
