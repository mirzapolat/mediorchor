import { useOutletContext } from 'react-router-dom';
import type { Project } from '@/types';

export interface ProjectOutletContext {
  project: Project;
  // Management rights for this project (admin or manager in scope). Without
  // it the user is a plain participant and only sees Teilnahme + Stücke.
  canManage: boolean;
  reloadProject: () => void;
  // Refreshes which areas the navigation shows (after publishing, …).
  reloadNav?: () => Promise<void>;
}

export const useProjectContext = () => useOutletContext<ProjectOutletContext>();
