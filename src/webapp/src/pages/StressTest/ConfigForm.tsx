import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, TextField } from '@heroui/react';
import { NumberField } from '@heroui/react/number-field';
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
  const [targetPort, setTargetPort] = useState(80);
  const [duration, setDuration] = useState(300);
  const [threads, setThreads] = useState(100);
  const [packetSize, setPacketSize] = useState(1024);
  const [continueAfterClose, setContinueAfterClose] = useState(true);

  const toggleMethod = (m: StressMethod) => {
    setMethods(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    );
  };

  const canStart = targetHost && methods.length > 0;

  const handleStart = () => {
    if (!canStart) return;
    onStart({
      name: `Stress ${new Date().toLocaleTimeString()}`,
      targetHost,
      targetPort,
      methods,
      durationSeconds: duration,
      continueAfterClose,
      threadsPerAgent: threads,
      packetSize,
    });
  };

  return (
    <Card className="p-4">
      <h2 className="text-lg font-semibold mb-3">{t('stressTest.title')}</h2>

      <div className="space-y-4">
        {/* Target */}
        <div className="grid grid-cols-4 gap-4">
          <TextField
            className="col-span-3"
            value={targetHost}
            onChange={(v) => setTargetHost(v)}
          >
            <Label>{t('stressTest.targetHost')}</Label>
            <Input placeholder="192.168.1.1" />
          </TextField>
          <NumberField
            className="w-full max-w-64"
            value={targetPort}
            minValue={1}
            maxValue={65535}
            onChange={(v) => setTargetPort(v)}
          >
            <Label>{t('stressTest.targetPort')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-[80px]" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>

        {/* Attack methods */}
        <div>
          <Label className="mb-2">{t('stressTest.attackMethods')}</Label>

          <div className="space-y-2">
            <div>
              <span className="text-xs text-neutral-500">{t('stressTest.layer4')}</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {LAYER4_METHODS.map(m => (
                  <button
                    key={m.id}
                    disabled={disabled}
                    onClick={() => toggleMethod(m.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      methods.includes(m.id)
                        ? 'bg-orange-100 border-orange-300 text-orange-800'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs text-neutral-500">{t('stressTest.layer7')}</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {LAYER7_METHODS.map(m => (
                  <button
                    key={m.id}
                    disabled={disabled}
                    onClick={() => toggleMethod(m.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      methods.includes(m.id)
                        ? 'bg-violet-100 border-violet-300 text-violet-800'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50'
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
        <div className="grid grid-cols-3 gap-4">
          <NumberField
            value={duration}
            minValue={1}
            maxValue={86400}
            onChange={(v) => setDuration(v)}
          >
            <Label>{t('stressTest.duration')}</Label>
            <NumberField.Group>
              <NumberField.Input className="w-full" />
            </NumberField.Group>
          </NumberField>
          <NumberField
            value={threads}
            minValue={1}
            maxValue={10000}
            onChange={(v) => setThreads(v)}
          >
            <Label>{t('stressTest.threads')}</Label>
            <NumberField.Group>
              <NumberField.Input className="w-full" />
            </NumberField.Group>
          </NumberField>
          <NumberField
            value={packetSize}
            minValue={64}
            maxValue={65500}
            onChange={(v) => setPacketSize(v)}
          >
            <Label>{t('stressTest.packetSize')}</Label>
            <NumberField.Group>
              <NumberField.Input className="w-full" />
            </NumberField.Group>
          </NumberField>
        </div>

        {/* Continue after close */}
        <div className="flex items-center justify-between py-1">
          <Label>{t('stressTest.continueAfterClose')}</Label>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={continueAfterClose}
              onChange={e => setContinueAfterClose(e.target.checked)}
              disabled={disabled}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:bg-primary-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="primary"
            isDisabled={disabled || !canStart}
            onPress={handleStart}
            className="flex-1"
          >
            {t('stressTest.startAttack')}
          </Button>
          <Button
            variant="ghost"
            isDisabled={!disabled}
            onPress={onStop}
            className="flex-1 text-danger"
          >
            {t('stressTest.stopAttack')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
