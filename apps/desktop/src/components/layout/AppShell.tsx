import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';
import { ProjectSwitcher } from './ProjectSwitcher';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900">
      <ProjectSwitcher />
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <MainArea activeView={activeView} />
    </div>
  );
}
