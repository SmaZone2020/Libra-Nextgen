import { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeepAliveWorkspace, type PageRouteDef } from './KeepAliveWorkspace';

// Module-level mount counters so probes can observe real unmount/remount.
const mountCounts: Record<string, number> = {};

function Probe({ id }: { id: string }) {
  const [count, setCount] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    mountCounts[id] = (mountCounts[id] ?? 0) + 1;
    // Re-render so the displayed mount counter reflects the effect result.
    setTick((t) => t + 1);
  }, [id]);

  return (
    <div data-testid={`probe-${id}`}>
      <span data-testid={`mount-${id}`}>{mountCounts[id] ?? 0}</span>
      <span data-testid={`count-${id}`}>{count}</span>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        inc-{id}
      </button>
    </div>
  );
}

const routes: PageRouteDef[] = [
  { key: 'kept', pattern: '/kept', element: <Probe id="kept" />, keep: true, layout: 'fill' },
  { key: 'plain', pattern: '/plain', element: <Probe id="plain" />, keep: false, layout: 'scroll' },
];

function Harness() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate('/kept')}>
        go-kept
      </button>
      <button type="button" onClick={() => navigate('/plain')}>
        go-plain
      </button>
      <KeepAliveWorkspace routes={routes} />
    </div>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter initialEntries={['/kept']}>
      <Harness />
    </MemoryRouter>,
  );
}

function slotPanel(key: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-page-slot="${key}"]`);
  if (!el) throw new Error(`page slot ${key} not found`);
  return el;
}

describe('KeepAliveWorkspace', () => {
  beforeEach(() => {
    Object.keys(mountCounts).forEach((k) => delete mountCounts[k]);
  });

  afterEach(() => {
    cleanup();
    Object.keys(mountCounts).forEach((k) => delete mountCounts[k]);
  });

  it('keeps keep-alive pages mounted and preserves state across navigation', () => {
    renderHarness();

    expect(screen.getByTestId('count-kept').textContent).toBe('0');
    fireEvent.click(screen.getByText('inc-kept'));
    expect(screen.getByTestId('count-kept').textContent).toBe('1');
    expect(screen.getByTestId('mount-kept').textContent).toBe('1');

    // Leave for a plain (non-kept) page: the kept panel hides but stays mounted.
    fireEvent.click(screen.getByText('go-plain'));
    expect(slotPanel('kept').style.display).toBe('none');
    expect(screen.queryByTestId('probe-kept')).not.toBeNull();
    expect(screen.getByTestId('mount-kept').textContent).toBe('1');
    expect(screen.getByTestId('count-kept').textContent).toBe('1');

    // Come back: state survived, no second mount.
    fireEvent.click(screen.getByText('go-kept'));
    expect(slotPanel('kept').style.display).not.toBe('none');
    expect(screen.getByTestId('count-kept').textContent).toBe('1');
    expect(screen.getByTestId('mount-kept').textContent).toBe('1');
  });

  it('unmounts non-kept pages when leaving and remounts them on return', () => {
    renderHarness();

    fireEvent.click(screen.getByText('go-plain'));
    expect(screen.getByTestId('count-plain').textContent).toBe('0');
    fireEvent.click(screen.getByText('inc-plain'));
    expect(screen.getByTestId('count-plain').textContent).toBe('1');
    expect(screen.getByTestId('mount-plain').textContent).toBe('1');

    fireEvent.click(screen.getByText('go-kept'));
    expect(screen.queryByTestId('probe-plain')).toBeNull();

    fireEvent.click(screen.getByText('go-plain'));
    expect(screen.getByTestId('count-plain').textContent).toBe('0');
    expect(screen.getByTestId('mount-plain').textContent).toBe('2');
  });
});
