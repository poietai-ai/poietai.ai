import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SettingsPanel } from './SettingsPanel';
import { OnboardingWizard } from '../onboarding/OnboardingWizard';
import { useSettingsStore } from '../../store/settingsStore';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const { onboardingComplete, loaded, completeOnboarding } = useSettingsStore();

  if (!loaded) return null;

  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={completeOnboarding} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900">
      <ProjectSwitcher />
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onSettings={() => setShowSettings(true)}
      />
      <MainArea activeView={activeView} />
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
