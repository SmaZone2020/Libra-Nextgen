import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import worldTopo from 'world-atlas/countries-110m.json';
import type { AgentListItem } from '../../types/models';
import { Card } from '@heroui/react';

interface GeoMapProps {
  agents: AgentListItem[];
}

export function GeoMap({ agents }: GeoMapProps) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{ agent: AgentListItem; x: number; y: number } | null>(null);

  const geoAgents = useMemo(
    () => agents.filter(a => a.geo?.latitude && a.geo?.longitude),
    [agents],
  );

  return (
    <Card>
      {/* Map area */}
      <div className="relative">
        {geoAgents.length === 0 ? (
          <div className="flex items-center justify-center h-[220px] text-neutral-400 text-sm">
            {t('dashboard.noGeoData')}
          </div>
        ) : (
          <ComposableMap
            projection="geoEqualEarth"
            projectionConfig={{ center: [0, 20], scale: 120 }}
            width={600}
            height={260}
            style={{ width: '100%', height: 'auto' }}
          >
            <Geographies geography={worldTopo}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#f4f4f6"
                    stroke="#d4d4d8"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover: { fill: '#e4e4e7', outline: 'none' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {geoAgents.map(agent => (
              <Marker
                key={agent.id}
                coordinates={[agent.geo!.longitude, agent.geo!.latitude]}
                onMouseEnter={(e) => {
                  const svg = (e.target as SVGElement).closest('svg');
                  if (svg) {
                    const rect = svg.getBoundingClientRect();
                    setTooltip({ agent, x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                <circle
                  r={agent.status === 'Online' ? 5 : 3.5}
                  fill={agent.status === 'Online' ? '#22c55e' : '#9ca3af'}
                  stroke="#fff"
                  strokeWidth={1.5}
                  style={{ cursor: 'pointer' }}
                />
              </Marker>
            ))}
          </ComposableMap>
        )}

        {/* Hover tooltip */}
        {tooltip && (
          <div
            className="absolute z-10 bg-neutral-900 text-white rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none whitespace-nowrap"
            style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}
          >
            <div className="font-medium">{tooltip.agent.hostname}</div>
            <div className="text-neutral-300">{tooltip.agent.geo?.region}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
        <span>{t('dashboard.agentsWithGeo', { count: geoAgents.length })}</span>
        <span>{agents.length} {t('dashboard.totalAgents').toLowerCase()}</span>
      </div>
    </Card>
  );
}
