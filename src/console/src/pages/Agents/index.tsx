import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentBrowser } from './AgentBrowser';
import { AgentDetailModal } from './AgentDetailModal';
import { MobileBuilderEntry } from './MobileBuilderEntry';
import { useAgent } from '../../contexts/AgentContext';
import { getAgent } from '../../api/agents';
import type { AgentDetail } from '../../types/models';

export default function AgentsPage() {
  const navigate = useNavigate();
  const { agents, agentId } = useAgent();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgent, setModalAgent] = useState<AgentDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Desktop shows the detail modal in place; mobile keeps the dedicated page.
  const handleOpen = (id: string) => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) {
      setModalOpen(true);
      setModalLoading(true);
      setModalAgent(null);
      getAgent(id)
        .then((detail) => setModalAgent(detail))
        .catch(() => setModalAgent(null))
        .finally(() => setModalLoading(false));
      return;
    }
    navigate(`/agents/${id}`);
  };

  return (
    <div className="space-y-3">
      <MobileBuilderEntry />
      <AgentBrowser
        agents={agents}
        connectedId={agentId}
        onOpen={handleOpen}
      />
      <AgentDetailModal
        isOpen={modalOpen}
        onOpenChange={setModalOpen}
        agent={modalAgent}
        loading={modalLoading}
      />
    </div>
  );
}
