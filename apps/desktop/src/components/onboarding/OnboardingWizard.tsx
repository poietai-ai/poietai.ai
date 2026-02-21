// apps/desktop/src/components/onboarding/OnboardingWizard.tsx
import { useState } from 'react';
import { StepConnectGitHub } from './StepConnectGitHub';
import { StepAddProject } from './StepAddProject';
import { StepCreateAgent } from './StepCreateAgent';

interface Props {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);

  const steps = ['Connect GitHub', 'Add project', 'Create agent'];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950">
      <div className="flex flex-col items-center w-full max-w-2xl px-8">
        {/* Logo / brand */}
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center mb-8">
          <span className="text-white text-xl font-bold">P</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 mb-10">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium
                  ${i + 1 < step ? 'bg-indigo-600 text-white' :
                    i + 1 === step ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-2 ring-offset-neutral-950' :
                    'bg-neutral-800 text-neutral-500'}`}>
                  {i + 1 < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs ${i + 1 === step ? 'text-neutral-200' : 'text-neutral-600'}`}>
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && <div className="w-8 h-px bg-neutral-700" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === 1 && (
          <StepConnectGitHub
            onNext={() => setStep(2)}
            onSkip={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepAddProject
            onNext={() => setStep(3)}
            onSkip={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepCreateAgent
            onComplete={onComplete}
            onSkip={onComplete}
          />
        )}
      </div>
    </div>
  );
}
