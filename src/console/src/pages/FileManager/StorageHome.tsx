'use client';

import { useTranslation } from 'react-i18next';
import { Chip } from '@heroui/react';
import {
  ArrowDownToLine,
  Display,
  FileText,
  Folder,
  Globe,
  HardDrive,
  MusicNote,
  Person,
  Picture,
  Video,
} from '@gravity-ui/icons';
import type { DriveInfo, SpecialDir } from '../../api/files';

export interface StorageHomeProps {
  drives: DriveInfo[];
  special: SpecialDir[];
  onEnter: (path: string) => void;
}

/** Human readable size: B/KB/MB/GB/TB. */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

const DRIVE_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  local: HardDrive,
  removable: HardDrive,
  network: Globe,
  cdrom: HardDrive,
  ram: HardDrive,
};

const DRIVE_KIND_LABEL: Record<string, string> = {
  local: '本地磁盘',
  removable: '可移动',
  network: '网络',
  cdrom: '光驱',
  ram: '内存盘',
  unknown: '未知',
};

const SPECIAL_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  desktop: Display,
  downloads: ArrowDownToLine,
  documents: FileText,
  pictures: Picture,
  music: MusicNote,
  videos: Video,
  user: Person,
};

const SPECIAL_LABEL: Record<string, string> = {
  desktop: '桌面',
  downloads: '下载',
  documents: '文档',
  pictures: '图片',
  music: '音乐',
  videos: '视频',
  user: '用户',
};

export function StorageHome({ drives, special, onEnter }: StorageHomeProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-default-700">
            {t('fileManager.drives')}
            <span className="ml-2 text-xs font-normal text-default-400">{drives.length}</span>
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(drives ?? []).map((d) => {
            const Icon = DRIVE_ICONS[d.kind] ?? HardDrive;
            const used = Math.max(0, d.total - d.free);
            const pct = d.total > 0 ? Math.min(100, Math.round((used / d.total) * 100)) : 0;
            return (
              <button
                key={d.path}
                onClick={() => onEnter(d.path)}
                className="group flex cursor-pointer flex-col gap-3 rounded-[20px] border border-default-200 bg-default-50/40 p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 dark:border-default-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-[14px] bg-default-100 text-default-600 dark:bg-default-800">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-semibold">{d.path}</div>
                      <Chip size="sm" variant="soft" className="mt-0.5">
                        {DRIVE_KIND_LABEL[d.kind] ?? d.kind}
                      </Chip>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-default-200 dark:bg-default-800"
                  >
                    <div
                      className={pct >= 90 ? 'h-full bg-danger' : pct >= 70 ? 'h-full bg-warning' : 'h-full bg-accent'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-default-500">
                    <span>
                      {t('fileManager.usedOf', {
                        used: formatSize(used),
                        total: formatSize(d.total),
                        percent: pct,
                      })}
                    </span>
                    <span className="font-medium text-default-600">
                      {t('fileManager.freeSpace', { free: formatSize(d.free) })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-default-700">
            {t('fileManager.specialDirs')}
            <span className="ml-2 text-xs font-normal text-default-400">{special.length}</span>
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(special ?? []).map((s) => {
            const Icon = SPECIAL_ICONS[s.name] ?? Folder;
            const label = SPECIAL_LABEL[s.name] ?? s.name;
            return (
              <button
                key={s.path}
                onClick={() => onEnter(s.path)}
                className="group flex cursor-pointer items-center gap-3 rounded-[20px] border border-default-200 bg-default-50/40 p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 dark:border-default-800"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-accent/10 text-accent">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{label}</div>
                  <div className="truncate font-mono text-[11px] text-default-500">{s.path}</div>
                </div>
                <Folder className="size-4 shrink-0 text-default-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
          {(special ?? []).length === 0 && (
            <div className="col-span-full py-6 text-center text-sm text-default-400">
              {t('fileManager.noSpecialDirs')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}