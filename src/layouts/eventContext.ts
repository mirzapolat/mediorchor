import { useOutletContext } from 'react-router-dom';
import type { Event, Project } from '@/types';

export interface EventOutletContext {
  project: Project;
  event: Event;
  reloadEvent: () => void;
  reloadCheckinWarnings: () => Promise<void>;
}

export const useEventContext = () => useOutletContext<EventOutletContext>();
