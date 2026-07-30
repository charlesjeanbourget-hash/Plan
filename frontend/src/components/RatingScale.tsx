import { RATING_LABELS } from '@/lib/evaluations';

interface Props {
  value: number | undefined;
  onChange: (v: number) => void;
  testId: string;
}

export const RatingScale = ({ value, onChange, testId }: Props): JSX.Element => (
  <div className="flex items-center gap-1.5">
    {[1, 2, 3, 4, 5].map((v) => (
      <button
        key={v}
        type="button"
        data-testid={`${testId}-${v}`}
        onClick={() => onChange(v)}
        title={RATING_LABELS[v - 1]}
        className={`w-9 h-9 rounded-full text-sm font-bold border-2 transition-all ${
          (value ?? 0) >= v
            ? 'bg-emerald-600 border-emerald-600 text-white'
            : 'border-slate-200 text-slate-400 hover:border-emerald-300'
        }`}
      >
        {v}
      </button>
    ))}
    <span className="ml-2 text-xs text-slate-500 font-semibold min-w-[80px]">
      {value ? RATING_LABELS[value - 1] : 'À noter'}
    </span>
  </div>
);
