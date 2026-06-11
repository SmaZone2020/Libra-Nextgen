import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Select, Switch } from '@heroui/react';
import type { StressMethod } from '../../types/models';

const LAYER4_METHODS: { id: StressMethod; label: string }[] = [
  { id: 'synFlood', label: 'SYN Flood' },
  { id: 'udpFlood', label: 'UDP Flood' },
  { id: 'icmpFlood', label: 'ICMP Flood' },
  { id: 'reflection', label: 'Reflection Amp' },
];

const LAYER7_METHODS: { id: StressMethod; label: string }[] = [
  { id: 'httpFlood', label: 'HTTP Flood' },
  { id: 'slowloris', label: 'Slowloris' },
  { id: 'tcpConnFlood', label: 'TCP Conn Flood' },
  { id: 'malformed', label: 'Malformed Packet' },
];

interface Props {
  disabled: boolean;
  onStart: (data: FormData) => void;
  onStop: () => void;
}

export interface FormData {
  name: string;
  targetHost: string;
  targetPort: number;
  methods: StressMethod[];
  durationSeconds: number;
  continueAfterClose: boolean;
  threadsPerAgent: number;
  packetSize: number;
}

export function ConfigForm({ disabled, onStart, onStop }: Props) {
  const { t } = useTranslation();
  const [methods, setMethods] = useState<StressMethod[]>(['httpFlood']);
  const [targetHost, setTargetHost] = useState('127.0.0.1');
  const [targetPort, setTargetPort] = useState('80');
  const [duration, setDuration] = useState('300');
  const [threads, setThreads] = useState('100');
  const [packetSize, setPacketSize] = useState('1024');
  const [continueAfterClose, setContinueAfterClose] = useState(true);

  const toggleMethod = (m: StressMethod) => {
    setMethods(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    );
  };

  const handleStart = () => {
    if (!targetHost || methods.length === 0) return;
    onStart({
      name: `Stress ${new Date().toLocaleTimeString()}`,
      targetHost,
      targetPort: parseInt(targetPort) || 80,
      methods,
      durationSeconds: parseInt(duration) || 300,
      continueAfterClose,
      threadsPerAgent: parseInt(threads) || 100,
      packetSize: parseInt(packetSize) || 1024,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            {t('stressTest.targetHost')}
          </label>
          <Input
            size="sm"
            value={targetHost}
            onValueChange={setTargetHost}
            placeholder="192.168.1.1"
            isDisabled={disabled}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            {t('stressTest.targetPort')}
          </label>
          <Input
            size="sm"
            value={targetPort}
            onValueChange={setTargetPort}
            placeholder="80"
            isDisabled={disabled}
          />
        </div>
      </div>

      {/* Attack methods */}
      <div>
        <label className="block text-xs font-medium text-neutral-600 mb-2">
          {t('stressTest.attackMethods')}
        </label>

        <div className="space-y-2">
          <div>
            <span className="text-[11px] text-neutral-500">{t('stressTest.layer4')}</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {LAYER4_METHODS.map(m => (
                <button
                  key={m.id}
                  disabled={disabled}
                  onClick={() => toggleMethod(m.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    methods.includes(m.id)
                      ? 'bg-orange-100 border-orange-300 text-orange-800'
                      : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[11px] text-neutral-500">{t('stressTest.layer7')}</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {LAYER7_METHODS.map(m => (
                <button
                  key={m.id}
                  disabled={disabled}
                  onClick={() => toggleMethod(m.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    methods.includes(m.id)
                      ? 'bg-violet-100 border-violet-300 text-violet-800'
                      : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            {t('stressTest.duration')}
          </label>
          <Input size="sm" value={duration} onValueChange={setDuration} isDisabled={disabled} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            {t('stressTest.threads')}
          </label>
          <Input size="sm" value={threads} onValueChange={setThreads} isDisabled={disabled} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            {t('stressTest.packetSize')}
          </label>
          <Input size="sm" value={packetSize} onValueChange={setPacketSize} isDisabled={disabled} />
        </div>
      </div>

      {/* Continue after close */}
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-neutral-700">{t('stressTest.continueAfterClose')}</span>
        <Switch
          isSelected={continueAfterClose}
          onValueChange={setContinueAfterClose}
          isDisabled={disabled}
          size="sm"
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          color="primary"
          isDisabled={disabled || methods.length === 0 || !targetHost}
          onPress={handleStart}
          className="flex-1"
        >
          {t('stressTest.startAttack')}
        </Button>
        <Button
          color="danger"
          isDisabled={!disabled}
          onPress={onStop}
          variant="bordered"
          className="flex-1"
        >
          {t('stressTest.stopAttack')}
        </Button>
      </div>
    </div>
  );
}
