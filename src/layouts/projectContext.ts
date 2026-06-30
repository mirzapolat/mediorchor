import { useOutletContext } from 'react-router-dom';
import type { Project } from '@/types';

export interface ProjectOutletContext {
  project: Project;
  reloadProject: () => void;
}

export const useProjectContext = () => useOutletContext<ProjectOutletContext>();
