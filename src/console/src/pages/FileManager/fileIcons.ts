import {
  File, FileCode, FileLetterP, FileLetterW, FileLetterX, FileText, FileZipper,
  Folder, MusicNote, Picture, Video,
} from '@gravity-ui/icons';
import type { ComponentType, SVGProps } from 'react';
import type { FileEntry } from '../../api/files';

type IconCtor = ComponentType<SVGProps<SVGSVGElement>>;

const extIcons: Record<string, IconCtor> = {
  png: Picture, jpg: Picture, jpeg: Picture, gif: Picture, svg: Picture,
  bmp: Picture, webp: Picture, ico: Picture, tiff: Picture, tif: Picture,
  mp4: Video, avi: Video, mkv: Video, mov: Video, webm: Video, wmv: Video,
  flv: Video, m4v: Video, mpg: Video, mpeg: Video,
  mp3: MusicNote, wav: MusicNote, flac: MusicNote, aac: MusicNote,
  ogg: MusicNote, wma: MusicNote, m4a: MusicNote,
  zip: FileZipper, rar: FileZipper, '7z': FileZipper, tar: FileZipper,
  gz: FileZipper, bz2: FileZipper, xz: FileZipper, zst: FileZipper,
  js: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode,
  py: FileCode, cs: FileCode, go: FileCode, rs: FileCode,
  java: FileCode, c: FileCode, cpp: FileCode, cc: FileCode, cxx: FileCode,
  h: FileCode, hpp: FileCode, json: FileCode, xml: FileCode,
  yaml: FileCode, yml: FileCode, html: FileCode, htm: FileCode,
  css: FileCode, scss: FileCode, less: FileCode,
  sh: FileCode, bash: FileCode, bat: FileCode, cmd: FileCode, ps1: FileCode,
  toml: FileCode, sql: FileCode, php: FileCode, rb: FileCode,
  swift: FileCode, kt: FileCode, scala: FileCode, dart: FileCode,
  vue: FileCode, svelte: FileCode, r: FileCode, lua: FileCode,
  pdf: FileLetterP,
  doc: FileLetterW, docx: FileLetterW, odt: FileText,
  xls: FileLetterX, xlsx: FileLetterX, ods: FileText,
  ppt: File, pptx: File, odp: File,
  txt: FileText, md: FileText, log: FileText, cfg: FileText,
  ini: FileText, env: FileText, readme: FileText,
};

export function fileIcon(entry: FileEntry): IconCtor {
  if (entry.type === 'dir') return Folder;
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  return extIcons[ext] ?? File;
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}
