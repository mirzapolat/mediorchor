import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { ProjectGroup } from '@/types';

interface ProjectGroupsValue {
  // The project's groups in their configured order.
  groups: ProjectGroup[];
  loaded: boolean;
  names: string[];
  // Case-insensitive lookup by name.
  find: (name: string | null | undefined) => ProjectGroup | undefined;
  reload: () => Promise<void>;
}

const ProjectGroupsContext = createContext<ProjectGroupsValue>({
  groups: [],
  loaded: false,
  names: [],
  find: () => undefined,
  reload: async () => {},
});

// Loads a project's groups once for everything rendered inside a project or
// event layout (group pills, dropdowns, filters).
export const ProjectGroupsProvider = ({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) => {
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await api
      .from('project_groups')
      .select('*')
      .eq('project_id', projectId)
      .order('position')
      .order('created_at');
    setGroups((data as ProjectGroup[] | null) ?? []);
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<ProjectGroupsValue>(() => {
    const byName = new Map(groups.map((g) => [g.name.toLowerCase(), g]));
    return {
      groups,
      loaded,
      names: groups.map((g) => g.name),
      find: (name) => (name ? byName.get(name.toLowerCase()) : undefined),
      reload,
    };
  }, [groups, loaded, reload]);

  return <ProjectGroupsContext.Provider value={value}>{children}</ProjectGroupsContext.Provider>;
};

export const useProjectGroups = () => useContext(ProjectGroupsContext);
