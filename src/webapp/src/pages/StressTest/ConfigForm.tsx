import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, Switch, TextField } from '@heroui/react';
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
  initialData?: Partial<FormData>;
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

export function ConfigForm({ disabled, onStart, onStop, initialData }: Props) {
  const { t } = useTranslation();
  const [methods, setMethods] = useState<StressMethod[]>(initialData?.methods ?? ['httpFlood']);
  const [targetHost, setTargetHost] = useState(initialData?.targetHost ?? '127.0.0.1');
  const [targetPort, setTargetPort] = useState(initialData?.targetPort ?? 80);
  const [duration, setDuration] = useState(initialData?.durationSeconds ?? 300);
  const [threads, setThreads] = useState(initialData?.threadsPerAgent ?? 100);
  const [packetSize, setPacketSize] = useState(initialData?.packetSize ?? 1024);
  const [continueAfterClose, setContinueAfterClose] = useState(initialData?.continueAfterClose ?? true);

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
        <div className="flex items-center gap-2">
          <TextField
            className="w-6/8 col-span-2"
            value={targetHost}
            onChange={(v) => setTargetHost(v)}
          >
            <Label className='text-base'>{t('stressTest.targetHost')}</Label>
            <Input placeholder="192.168.1.1" />
          </TextField>
          <NumberField
            className="w-2/8 col-span-1"
            value={targetPort}
            minValue={1}
            maxValue={65535}
            onChange={(v) => setTargetPort(v)}
          >
            <Label className='text-base'>{t('stressTest.targetPort')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-[80px] text-center" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>

        {/* Attack methods */}
        <div>
          <Label className="mb-2 text-base">{t('stressTest.attackMethods')}</Label>

          <div className="space-y-2">
            <div>
              <span className="text-sm text-neutral-500">{t('stressTest.layer4')}</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {LAYER4_METHODS.map(m => (
                  <Button
                    key={m.id}
                    isDisabled={disabled}
                    onClick={() => toggleMethod(m.id)}
                    variant='tertiary'
                    className={`${
                      methods.includes(m.id)
                        ? 'bg-orange-100 border-orange-300 text-orange-800'
                        : 'text-neutral-600 hover:bg-neutral-50 disabled:opacity-50'
                    }`}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-sm text-neutral-500">{t('stressTest.layer7')}</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {LAYER7_METHODS.map(m => (
                  <Button
                    key={m.id}
                    isDisabled={disabled}
                    onClick={() => toggleMethod(m.id)}
                    variant='tertiary'
                    className={`${
                      methods.includes(m.id)
                        ? 'bg-violet-100 border-violet-300 text-violet-800'
                        : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50'
                    }`}
                  >
                    {m.label}
                  </Button>
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
            <Label className='text-base'>{t('stressTest.duration')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full text-center" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
          <NumberField
            value={threads}
            minValue={1}
            maxValue={10000}
            onChange={(v) => setThreads(v)}
          >
            <Label className='text-base'>{t('stressTest.threads')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full text-center" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
          <NumberField
            value={packetSize}
            minValue={64}
            maxValue={65500}
            onChange={(v) => setPacketSize(v)}
          >
            <Label className='text-base'>{t('stressTest.packetSize')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full text-center" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>

        {/* Continue after close */}
        <Switch
          isSelected={continueAfterClose}
          onChange={setContinueAfterClose}
          isDisabled={disabled}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm">{t('stressTest.continueAfterClose')}</Label>
          </Switch.Content>
        </Switch>

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
