export interface SwapStep {
	label: string;
	done: boolean;
}

export interface SwapStepperProps {
	steps: SwapStep[];
}

/** Horizontal progress of a cross-chain transfer. */
export const SwapStepper: React.FC<SwapStepperProps> = ({ steps }) => (
	<ul className="steps w-full text-xs">
		{steps.map((s) => (
			<li key={s.label} className={`step ${s.done ? "step-primary" : ""}`}>
				{s.label}
			</li>
		))}
	</ul>
);
