'use client';

const TYPE_ICONS: Record<string, string> = {
  telegram: '/icon/app/tg.png',
  lark: '/icon/app/lark.png',
  'wechat-claw': '/icon/app/wechat.png',
};

export default function ChannelIcon({ type, className }: { type: string; className?: string }) {
  const src = TYPE_ICONS[type];
  if (!src) return null;
  return <img src={src} alt={type} className={`size-10 object-contain rounded-full ${className ?? ''}`} />;
}
